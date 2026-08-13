/**
 * Rate limiting for /api/*.
 *
 * WHY THE NUMBERS ARE WHAT THEY ARE
 *
 * Every /api/analyze request spends from the Gemini free tier, which is shared
 * by the whole team:
 *
 *   - 15 requests per minute  (burst ceiling)
 *   - 1,500 requests per day  (daily ceiling)
 *
 * Both ceilings are per *project key*, not per person. Four teammates develop
 * against the same key, so one runaway loop in someone's dev tab can exhaust
 * the day's quota for everyone — including during the demo. Two limiters, one
 * per ceiling:
 *
 * BURST — 5 requests per minute per IP.
 *   The provider allows 15/min in total. Capping a single client at 5 means
 *   three clients can be active simultaneously without any of them being the
 *   reason we hit the provider's limit. A human photographing food does not
 *   exceed 5 requests a minute; a broken retry loop does immediately, which is
 *   exactly the case this is here to stop.
 *
 * DAILY — 100 requests per IP per day.
 *   Worst case with four developers on four IPs is 400 requests, comfortably
 *   under 1,500, leaving roughly two thirds of the quota as headroom for demo
 *   day and for graders trying the deployed app. 100 analyses a day is far more
 *   than manual testing needs; anything past it is a loop, not a person.
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

/** Stops runaway loops within a minute, before they reach the provider's RPM cap. */
export const burstRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: limitMessage,
})

/** Protects the shared 1,500/day quota from being drained by one client. */
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
