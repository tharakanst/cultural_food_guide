/**
 * Tests for the burst rate limiter.
 *
 * express-rate-limit tracks counts per key (IP, by default) for the lifetime
 * of the limiter instance, so this file deliberately does everything in a
 * single test per limiter instance rather than splitting into many `it`
 * blocks — splitting would make the requests-so-far count (and therefore
 * which assertion trips the limit) depend on the order tests happen to run
 * in, which is exactly the kind of order-dependent flakiness this project
 * cannot afford in `npm run verify`.
 *
 * The daily limiter (100/day) is not exercised end-to-end with 100 requests:
 * that would make this file slow for a bound that is not going to be hit in
 * any plausible dev or demo session. It is a real coverage gap — see the
 * accompanying report.
 */
import { describe, expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import { burstRateLimit } from './rateLimit'

function buildApp() {
  const app = express()
  app.use('/api', burstRateLimit)
  app.get('/api/probe', (_req, res) => res.status(200).json({ ok: true }))
  return app
}

describe('burstRateLimit', () => {
  it('allows 15 requests per minute per client and rejects the 16th with a distinguishable message', async () => {
    const app = buildApp()

    for (let i = 0; i < 15; i++) {
      const res = await request(app).get('/api/probe')
      expect(res.status).toBe(200)
    }

    const limited = await request(app).get('/api/probe')
    expect(limited.status).toBe(429)
    expect(limited.body).toEqual({
      error: 'Too many requests. Please wait a moment and try again.',
    })
    // Distinguishable from a generic server failure by message content: the
    // app has no other UI signal for this (see App.test.tsx / report).
    expect(limited.body.error).not.toBe('Failed to analyze image')
  })

  it('advertises the limit via standard rate-limit headers', async () => {
    const app = buildApp()
    const res = await request(app).get('/api/probe')
    const headerNames = Object.keys(res.headers).join(',')
    expect(headerNames).toMatch(/ratelimit/i)
  })
})
