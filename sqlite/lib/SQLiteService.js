const { SQLService } = require('@cap-js/db-service')
const { Readable } = require('stream')
const cds = require('@sap/cds/lib')
const sqlite = require('better-sqlite3')
const $session = Symbol('dbc.session')
const convStrm = require('stream/consumers')

class SQLiteService extends SQLService {
  get factory() {
    return {
      options: { max: 1, ...this.options.pool },
      create: tenant => {
        const database = this.url4(tenant)
        const dbc = new sqlite(database)
        dbc.function('session_context', key => dbc[$session][key])
        dbc.function('regexp', { deterministic: true }, (re, x) => (RegExp(re).test(x) ? 1 : 0))
        dbc.function('ISO', { deterministic: true }, d => d && new Date(d).toISOString())
        if (!dbc.memory) dbc.pragma('journal_mode = WAL')
        return dbc
      },
      destroy: dbc => dbc.close(),
      validate: dbc => dbc.open,
    }
  }

  url4(tenant) {
    let { url, database: db = url } = this.options.credentials || this.options || {}
    if (!db || db === ':memory:') return ':memory:'
    if (tenant) db = db.replace(/\.(db|sqlite)$/, `-${tenant}.$1`)
    return cds.utils.path.resolve(cds.root, db)
  }

  set(variables) {
    const dbc = this.dbc || cds.error('Cannot set session context: No database connection')
    if (!dbc[$session]) dbc[$session] = variables
    else Object.assign(dbc[$session], variables)
  }

  release() {
    this.dbc[$session] = undefined
    return super.release()
  }

  prepare(sql) {
    try {
      const stmt = this.dbc.prepare(sql)
      return {
        run: (..._) => this._run(stmt, ..._),
        get: (..._) => stmt.get(..._),
        all: (..._) => stmt.all(..._),
        stream: (..._) => this._stream(stmt, ..._),
      }
    } catch (e) {
      e.message += ' in:\n' + (e.sql = sql)
      throw e
    }
  }

  async _run(stmt, binding_params) {
    for (let i = 0; i < binding_params.length; i++) {
      const val = binding_params[i]
      if (Buffer.isBuffer(val)) {
        binding_params[i] = Buffer.from(val.base64Slice())
      } else if (typeof val === 'object' && val && val.pipe) {
        // REVISIT: stream.setEncoding('base64') sometimes misses the last bytes
        // if (val.type === 'binary') val.setEncoding('base64')
        binding_params[i] = await convStrm.buffer(val)
        if (val.type === 'binary') binding_params[i] = Buffer.from(binding_params[i].toString('base64'))
      }
    }
    return stmt.run(binding_params)
  }

  async *_iterator(rs, one) {
    // Allow for both array and iterator result sets
    const first = Array.isArray(rs) ? { done: !rs[0], value: rs[0] } : rs.next()
    if (first.done) return
    if (one) {
      yield first.value[0]
      // Close result set to release database connection
      rs.return()
      return
    }

    yield '['
    // Print first value as stand alone to prevent comma check inside the loop
    yield first.value[0]
    for (const row of rs) {
      yield `,${row[0]}`
    }
    yield ']'
  }

  async _stream(stmt, binding_params, one) {
    const columns = stmt.columns()
    // Stream single blob column
    if (columns.length === 1 && columns[0].name !== '_json_') {
      // Setting result set to raw to keep better-sqlite from doing additional processing
      stmt.raw(true)
      const rows = stmt.all(binding_params)
      // REVISIT: return undefined when no rows are found
      if (rows.length === 0) return undefined
      if (rows[0][0] === null) return null
      // Buffer.from only applies encoding when the input is a string
      let raw = Buffer.from(rows[0][0].toString(), 'base64')
      stmt.raw(false)
      return new Readable({
        read(size) {
          if (raw.length === 0) return this.push(null)
          const chunk = raw.slice(0, size)
          raw = raw.slice(size)
          this.push(chunk)
        },
      })
    }

    stmt.raw(true)
    const rs = stmt.iterate(binding_params)
    return Readable.from(this._iterator(rs, one))
  }

  exec(sql) {
    return this.dbc.exec(sql)
  }

  static CQN2SQL = class CQN2SQLite extends SQLService.CQN2SQL {

    column_alias4(x, q) {
      let alias = super.column_alias4(x, q)
      if (alias) return alias
      if (x.ref) {
        let obm = q._orderByMap
        if (!obm) {
          Object.defineProperty(q, '_orderByMap', { value: (obm = {}) })
          q.SELECT?.orderBy?.forEach(o => {
            if (o.ref?.length === 1) obm[o.ref[0]] = o.ref[0]
          })
        }
        return obm[x.ref.at(-1)]
      }
    }

    // Used for INSERT statements
    static InputConverters = {
      ...super.InputConverters,

      // The following allows passing in ISO strings with non-zulu
      // timezones and converts them into zulu dates and times
      Date: e => `strftime('%Y-%m-%d',${e})`,
      Time: e => `strftime('%H:%M:%S',${e})`,

      // Both, DateTimes and Timestamps are canonicalized to ISO strings with
      // ms precision to allow safe comparisons, also to query {val}s in where clauses
      DateTime: e => `ISO(${e})`,
      Timestamp: e => `ISO(${e})`,
    }

    static OutputConverters = {
      ...super.OutputConverters,

      // Structs and arrays are stored as JSON strings; the ->'$' unwraps them.
      // Otherwise they would be added as strings to json_objects.
      struct: expr => `${expr}->'$'`, // Association + Composition inherits from struct
      array: expr => `${expr}->'$'`,

      // SQLite has no booleans so we need to convert 0 and 1
      boolean: expr => `CASE ${expr} when 1 then 'true' when 0 then 'false' END ->'$'`,

      // DateTimes are returned without ms added by InputConverters
      DateTime: e => `substr(${e},0,20)||'Z'`,

      // Timestamps are returned with ms, as written by InputConverters.
      // And as cds.builtin.classes.Timestamp inherits from DateTime we need
      // to override the DateTime converter above
      Timestamp: e => `ISO(${e})`,
      // REVISIT: generic-virtual.test.js expects now to be returned as ISO string
      // test 'field with current timestamp is correctly formatted' fails otherwise

      // Quote Decimal values to lose the least amount of precision
      // quote turns 9999999999999.999 into  9999999999999.998
      // || '' turns 9999999999999.999 into 10000000000000.0
      Decimal: expr => `nullif(quote(${expr}),'NULL')`,
      // Don't read Float as string as it should be a safe number
      // Float: expr => `nullif(quote(${expr}),'NULL')->'$'`,

      // Without quote 1.7976931348623157e308 is returned as Infinity
      Double: expr => `nullif(quote(${expr}),'NULL')->'$'`,

      // int64 is stored as native int64 for best comparison
      // Reading int64 as string to not loose precision
      Int64: expr => `CAST(${expr} as TEXT)`,

      // Binary is not allowed in json objects
      Binary: expr => `${expr} || ''`,
    }

    // Used for SQL function expressions
    // static Functions = { ...super.Functions }

    // Used for CREATE TABLE statements
    static TypeMap = {
      ...super.TypeMap,
      Binary: e => `BINARY_BLOB(${e.length || 5000})`,
      Date: () => 'DATE_TEXT',
      Time: () => 'TIME_TEXT',
      DateTime: () => 'DATETIME_TEXT',
      Timestamp: () => 'TIMESTAMP_TEXT',
    }

    get is_() { return 'is' }
    get is_not_() { return 'is not' }

    static ReservedWords = { ...super.ReservedWords, ...require('./ReservedWords.json') }
  }

  // REALLY REVISIT: Here we are doing error handling which we probably never should have started.
  // And worst of all, we handed out this as APIs without documenting it, so stakeholder tests rely
  // on that? -> we urgently need to review these stakeholder tests.
  // And we'd also need this to be implemented by each db service, and therefore documented, correct?
  async onINSERT(req) {
    try {
      return await super.onINSERT(req)
    } catch (err) {
      throw _not_unique(err, 'ENTITY_ALREADY_EXISTS') || err
    }
  }

  async onUPDATE(req) {
    try {
      return await super.onUPDATE(req)
    } catch (err) {
      throw _not_unique(err, 'UNIQUE_CONSTRAINT_VIOLATION') || err
    }
  }
}

// function _not_null (err) {
//   if (err.code === "SQLITE_CONSTRAINT_NOTNULL") return Object.assign ({
//     code: 'MUST_NOT_BE_NULL',
//     target: /\.(.*?)$/.exec(err.message)[1], // here we are even constructing OData responses, with .target
//     message: 'Value is required',
//   })
// }

function _not_unique(err, code) {
  if (err.message.match(/unique constraint/i))
    return Object.assign({
      originalMessage: err.message, // FIXME: required because of next line
      message: code, // FIXME: misusing message as code
      code: 400, // FIXME: misusing code as (http) status
    })
}

module.exports = SQLiteService
