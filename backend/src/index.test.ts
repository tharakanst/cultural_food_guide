/**
 * Tests for the server wiring in index.ts — the middleware stack that
 * routes/analyze.test.ts deliberately bypasses by building its own minimal
 * app (see the comment at the top of that file).
 *
 * index.ts calls app.listen() as a side effect of module evaluation, with no
 * exported seam to build the app without binding a real port. That is a
 * genuine testability gap (see the report). This file works around it by
 * spying on express's shared `application.listen` before importing index.ts,
 * so the import never actually binds a socket; supertest talks to the
 * `app` instance directly regardless.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { Express } from 'express'

vi.mock('./services/aiService', () => ({ analyzeImage: vi.fn() }))
vi.mock('./services/imageService', () => ({ findReferenceImage: vi.fn() }))

describe('server wiring (src/index.ts)', () => {
  let app: Express
  let listenSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetModules()
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173'

    // Prevent the real app.listen() call in index.ts from binding a port.
    listenSpy = vi
      .spyOn(express.application as unknown as { listen: (...args: unknown[]) => unknown }, 'listen')
      .mockImplementation(() => ({ close: vi.fn() }))

    const mod = await import('./index')
    app = mod.default
  })

  afterEach(() => {
    listenSpy.mockRestore()
  })

  it('responds to the health check', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('returns a generic 404 for an unmatched route', async () => {
    const res = await request(app).get('/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not found' })
  })

  it('sets a restrictive CSP that still permits Wikimedia and data: images', async () => {
    const res = await request(app).get('/health')
    const csp = res.headers['content-security-policy']
    expect(csp).toBeDefined()
    expect(csp).toMatch(/img-src[^;]*upload\.wikimedia\.org/)
    expect(csp).toMatch(/img-src[^;]*data:/)
  })

  it('rejects a malformed JSON body with a generic 400 via the terminal error handler', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .send('{ this is not json')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Malformed request body' })
  })

  it('rejects a body over the outer 14MB JSON parser limit with a generic 413', async () => {
    const oversized = JSON.stringify({ image: 'a'.repeat(15 * 1024 * 1024) })
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .send(oversized)

    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'Image exceeds the 10MB limit' })
  })
})
