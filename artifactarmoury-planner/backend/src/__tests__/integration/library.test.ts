import express from 'express'
import request from 'supertest'

process.env.DB_MOCK = 'true'

const sessionRouter = require('../../middleware/session').default
const libraryRoutes = require('../../routes/library').default

function createTestApp() {
  const app = express()
  app.use(express.json())
  app.use(sessionRouter)
  app.use('/api/library', libraryRoutes)
  return app
}

describe('Asset Library routes (mocked DB)', () => {
  const app = createTestApp()

  it('returns an empty asset list and issues a session id', async () => {
    const response = await request(app).get('/api/library/assets')

    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty('assets')
    expect(Array.isArray(response.body.assets)).toBe(true)

    const sessionId = response.headers['x-session-id']
    expect(typeof sessionId === 'string' && sessionId.length > 0).toBe(true)
  })

  it('returns 404 when usage is tracked for a missing asset', async () => {
    const response = await request(app)
      .post('/api/library/assets/non-existent-asset/usage')
      .send({ tableId: 'table-123' })

    expect(response.status).toBe(404)
    expect(response.body).toHaveProperty('error')
  })
})
