const cds = require('@sap/cds')
const propagateForeignKeys = require('@sap/cds/libx/_runtime/common/utils/propagateForeignKeys')
const { enrichDataWithKeysFromWhere } = require('@sap/cds/libx/_runtime/common/utils/keys')

const generateUUIDandPropagateKeys = (target, data, event) => {
  if (!data) return
  const keys = target.keys
  for (const key in keys) {
    if (keys[key].type === 'cds.UUID' && !data[key] && event === 'CREATE') {
      data[key] = cds.utils.uuid()
    }
  }
  const elements = target.elements
  for (const element in elements) {
    // if assoc keys are structured, do not ignore them, as they need to be flattened in propagateForeignKeys
    if (elements[element].key && !(elements[element]._isAssociationStrict && elements[element].is2one && element in data)) {
      continue
    }

    if (elements[element].is2one || elements[element].is2many) {
      let subData = data[element]
      if (subData) {
        if (!Array.isArray(subData)) {
          subData = [subData]
        }
        for (const sub of subData) {
          generateUUIDandPropagateKeys(elements[element]._target, sub, event)
        }
      }

      propagateForeignKeys(element, data, elements[element]._foreignKeys, elements[element].isComposition, {
        deleteAssocs: true
      })
    }
  }
}

const input = async function (req, next) {
  // REVISIT dummy handler until we have input processing
  if (!req.target || !this.model || req.target._unresolved) return next()

  if (req.event === "UPDATE") {
    // REVISIT for deep update we need to inject the keys first
    enrichDataWithKeysFromWhere(req.data, req, this)
  }

  // REVISIT no input processing for INPUT with rows/values
  if (req.event !== 'DELETE' && !(req.query.INSERT?.rows || req.query.INSERT?.values)) {
    if (Array.isArray(req.data)) {
      for (const d of req.data) {
        generateUUIDandPropagateKeys(req.target, d, req.event)
      }
    } else {
      generateUUIDandPropagateKeys(req.target, req.data, req.event)
    }
  }

  return next()
}

module.exports = {
  input
}
