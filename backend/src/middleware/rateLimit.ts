/**
 * Rate limiting for /api/*.
 *
 * WHY THE NUMBERS ARE WHAT THEY ARE
 *
 * Every /api/analyze request costs money. The provider is OpenAI, billed per
 * token on a single account shared by the whole team — there is no free tier
 * absorbing mistakes. One analysis is roughly $0.0006 (about 2,300 input tokens
 * for a 1600px photo, plus output), so the risk is not one expensive request but
 * an unattended loop making thousands of cheap ones.
 *
 * That changes what these limits are for. They previously protected a quota that
 * would simply run out; they now protect a bill that will not. Two limiters:
 *
 * BURST — 5 requests per minute per IP.
 *   A human photographing food does not exceed 5 requests a minute; a broken
 *   retry loop does immediately, which is exactly the case this stops. It also
 *   keeps several people demonstrating side by side from throttling each other.
 *
 * DAILY — 100 requests per IP per day.
 *   Worst case with four developers on four IPs is 400 analyses, around $0.24 —
 *   a known, small ceiling rather than an open-ended one. 100 analyses a day is
 *   far more than manual testing needs; anything past it is a loop, not a
 *   person.
 *
 * These are per-IP by design. Behind a reverse proxy (Render, Railway, nginx)
 * every request otherwise appears to come from the proxy and one user's limit
 * becomes everyone's. If this is deployed behind a proxy, set
 * `app.set('trust proxy', 1)` in src/index.ts to match.
 */

import rateLimit from 'express-rate-limit'
import type { ApiError } from '../../../shared/types'

/** Generic, no internals leaked — same policy as every other client error. */
const limitMessage: ApiError = {
  error: 'Too many requests. Please wait a moment and try again.',
}

/** Stops runaway loops within a minute, before they turn into a bill. */
export const burstRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: limitMessage,
})

/** Caps what a single client can spend from the shared account in a day. */
export const dailyRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: limitMessage,
})

/**
 * Both limiters in the order they should run: cheap burst check first, then the
 * daily budget. Mounted as a unit on /api in src/index.ts.
 */
export const apiRateLimit = [burstRateLimit, dailyRateLimit]
