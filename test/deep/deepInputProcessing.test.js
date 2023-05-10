const cds = require('@cap-js/sqlite/test/cds.js')

const { POST, PUT } = cds.test(__dirname, 'deep.cds')

describe('UUID Generation', () => {
  test('generate UUID on insert', async () => {
    const uuid = cds.utils.uuid()
    const res = await POST('/bla/RootUUID', {
      ID: uuid,
      toOneChild: {
        text: 'abc',
        toManySubChild: [{ text: 'a' }, { text: 'b' }]
      }
    })
    expect(res.status).toBe(201)

    expect(res.data).toMatchObject({
      '@odata.context': '$metadata#RootUUID(toOneChild(toManySubChild()))/$entity',
      ID: uuid,
      name: null,
      toOneChild: {
        text: 'abc',
        toManySubChild: [{ text: 'a' }, { text: 'b' }]
      }
    })

    // uuid is properly generated
    expect(res.data.toOneChild.ID).toBeDefined()
    // and propagated
    expect(res.data.toOneChild.ID).toEqual(res.data.toOneChild_ID)
    // uuid is properly generated
    expect(res.data.toOneChild.toManySubChild[0].ID).toBeDefined()
    expect(res.data.toOneChild.toManySubChild[1].ID).toBeDefined()
    // and propagated
    expect(res.data.toOneChild.ID).toEqual(res.data.toOneChild.toManySubChild[0].backlink_ID)
    expect(res.data.toOneChild.ID).toEqual(res.data.toOneChild.toManySubChild[1].backlink_ID)
  })
  test('generate UUID on update', async () => {
    const uuid = cds.utils.uuid()
    const resPost = await POST('/bla/RootUUID', {
      ID: uuid,
      toOneChild: {
        text: 'abc',
        toManySubChild: [{ text: 'a' }, { text: 'b' }]
      }
    })
    expect(resPost.status).toBe(201)

    // new children are created
    const resUpdate = await PUT(`/bla/RootUUID(${uuid})`, {
      toOneChild: {
        text: 'abc',
        toManySubChild: [{ text: 'a' }, { text: 'b' }]
      }
    })
    expect(resUpdate.status).toBe(200)

    // foreign keys are set correctly (deep)
    expect(resUpdate.data.toOneChild.ID).toEqual(resUpdate.data.toOneChild_ID)
    expect(resUpdate.data.toOneChild.ID).toEqual(resUpdate.data.toOneChild.toManySubChild[0].backlink_ID)
    expect(resUpdate.data.toOneChild.ID).toEqual(resUpdate.data.toOneChild.toManySubChild[1].backlink_ID)
  })

  test('update root and delete child', async () => {
    const uuid = cds.utils.uuid()
    const resPost = await POST('/bla/RootUUID', {
      ID: uuid,
      toOneChild: {
        text: 'abc'
      }
    })
    expect(resPost.status).toBe(201)

    // child should be deleted
    const resUpdate = await PUT(`/bla/RootUUID(${uuid})`, {
      toOneChild: null
    })
    expect(resUpdate.status).toBe(200)

    expect(resUpdate.data).toMatchObject({
      '@odata.context': '$metadata#RootUUID/$entity',
      ID: uuid,
      name: null,
      toOneChild: null
    })
  })

  test('update on projection root', async () => {
    const resPost = await POST('/bla/SProjRoot', {
      rID: 1,
      rToOneChild: {
        rID: 2,
        rText: 'abc'
      }
    })
    expect(resPost.status).toBe(201)
  })
})
