/**
 * Server bootstrap — middleware, routes, port. No business logic here.
 */

import 'dotenv/config'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import type { ApiError } from '../../shared/types'
import { apiRateLimit } from './middleware/rateLimit'
import analyzeRouter from './routes/analyze'

const app = express()

const PORT = Number(process.env.PORT) || 4000
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // The frontend renders Wikimedia reference photos and the locally
        // captured photo, which is held as a data: URI before upload. Both must
        // be permitted or the result view shows broken images.
        'img-src': ["'self'", 'data:', 'https://upload.wikimedia.org'],
      },
    },
  }),
)

/**
 * Single origin, from the environment. Never widen this to '*' to fix a local
 * problem — set FRONTEND_ORIGIN instead. No credentials are used: the API is
 * stateless and there is nothing to authenticate.
 *
 * `Retry-After` is exposed deliberately. It is not on the CORS-safelisted
 * response header list, so without this the browser hides it from `fetch` even
 * though it is present on the wire — and the frontend cannot tell a per-minute
 * burst limit from the shared daily one, which are very different waits to ask
 * a user to sit through.
 */
app.use(cors({ origin: FRONTEND_ORIGIN, exposedHeaders: ['Retry-After'] }))

/**
 * Images arrive base64-encoded inside a JSON body, and base64 inflates a
 * payload by about a third. A 10 MB image is therefore a ~13.3 MB body, so this
 * ceiling is set above the documented 10 MB image cap rather than equal to it —
 * otherwise express.json would reject at ~7.5 MB of image and the stated limit
 * would be a lie.
 *
 * The route's own decoded-size check in analyze.ts is the real limit. This is
 * only the outer bound that stops an oversized body being buffered at all.
 */
app.use(express.json({ limit: '14mb' }))

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' })
})

app.use('/api', ...apiRateLimit, analyzeRouter)

/** Unmatched routes get the same generic treatment as everything else. */
app.use((_req: Request, res: Response<ApiError>) => {
  res.status(404).json({ error: 'Not found' })
})

/**
 * Terminal error handler. Catches what routes do not, most commonly
 * express.json rejecting an oversized or malformed body. Details stay in the
 * server log; the client gets a generic message.
 */
app.use((err: unknown, _req: Request, res: Response<ApiError>, next: NextFunction) => {
  if (res.headersSent) {
    next(err)
    return
  }

  const status =
    typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
      ? err.status
      : 500

  console.error('[server] unhandled error:', err)

  if (status === 413) {
    res.status(413).json({ error: 'Image exceeds the 10MB limit' })
    return
  }
  if (status === 400) {
    res.status(400).json({ error: 'Malformed request body' })
    return
  }

  res.status(500).json({ error: 'Failed to analyze image' })
})

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`)
  console.log(`CORS origin: ${FRONTEND_ORIGIN}`)
})

export default app
