import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnalyzeRequest, AnalyzeResponse, ApiError } from '../../shared/types'
import { CameraCapture } from './components/CameraCapture'
import { FoodResult } from './components/FoodResult'

/**
 * Our own backend — never a provider endpoint.
 *
 * The AI key lives in backend/.env and is read only by the service layer. A
 * provider SDK or key in this bundle would be shipped to every visitor.
 */
const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

/** Shown when the backend gives us nothing usable. Deliberately generic —
 *  detail belongs in the server log, not on a phone screen. */
const GENERIC_ERROR = 'Something went wrong while identifying this photo. Please try again.'

/**
 * A 429 is a usage limit, not a fault — see the `panel--notice` block below.
 * `kind` on the 'error' variant lets rendering and the live-region text treat
 * the two cases honestly instead of sharing "something went wrong" wording.
 */
type ErrorKind = 'request-failed' | 'rate-limited'

type AppState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; kind: ErrorKind; message: string; retryAfterSeconds: number | null }
  | { status: 'result'; data: AnalyzeResponse }

/**
 * The burst limiter's window is 60s and the daily limiter's is 24h (see
 * backend/src/middleware/rateLimit.ts), so if `Retry-After` is readable at all
 * a value at or under this is unambiguously the per-minute burst limit and
 * anything above it is the daily one.
 */
const BURST_WINDOW_SECONDS = 60

/**
 * `Retry-After` is not on the CORS-safelisted response header list, so it is
 * only readable here if the deployment explicitly sets
 * `Access-Control-Expose-Headers: Retry-After` (frontend code cannot add
 * that — it lives in backend CORS config). Read defensively and degrade to an
 * honest, less specific message rather than assuming it is always present.
 */
function readRetryAfterSeconds(response: Response): number | null {
  const raw = response.headers?.get('Retry-After')
  if (!raw) return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

function formatWait(seconds: number): string {
  if (seconds < 90) {
    return seconds <= 5 ? 'a few seconds' : 'about a minute'
  }
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 90) return `about ${minutes} minutes`
  const hours = Math.ceil(seconds / 3600)
  return hours <= 1 ? 'about an hour' : `about ${hours} hours`
}

/**
 * The second sentence of the rate-limit panel — the part that says how long
 * to wait and, where the response tells us, which of the two limits this is.
 * Never call this "a problem on our side": it is the opposite, the service
 * doing what it is designed to do under load.
 */
function describeRateLimitWait(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null) {
    return (
      'This is a usage limit, not a fault with your photo or our service. It is either a ' +
      'short per-minute limit or the shared daily limit — wait a minute and try again, and ' +
      'if it still will not go through, try again after a longer break.'
    )
  }
  if (retryAfterSeconds <= BURST_WINDOW_SECONDS) {
    return (
      `This app allows a few requests per minute so it stays available to everyone nearby. ` +
      `Wait ${formatWait(retryAfterSeconds)} and try again — the same photo is fine.`
    )
  }
  return (
    `The shared daily limit for this service has been reached. This is not a fault with ` +
    `your photo — please try again in ${formatWait(retryAfterSeconds)}.`
  )
}

/** Type guard rather than a cast: the response body is untrusted. */
function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' && value !== null && typeof (value as ApiError).error === 'string'
  )
}

/** Minimal shape check so a malformed body surfaces as an error state rather
 *  than crashing on `.map` of undefined. */
function isAnalyzeResponse(value: unknown): value is AnalyzeResponse {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AnalyzeResponse>
  return (
    typeof candidate.identified === 'boolean' &&
    typeof candidate.name === 'string' &&
    typeof candidate.description === 'string' &&
    Array.isArray(candidate.ingredients) &&
    Array.isArray(candidate.allergens) &&
    typeof candidate.culturalContext === 'string' &&
    typeof candidate.disclaimer === 'string'
  )
}

export function App() {
  const [state, setState] = useState<AppState>({ status: 'idle' })
  const [image, setImage] = useState<string | null>(null)

  const resultRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const identifyButtonRef = useRef<HTMLButtonElement | null>(null)

  // Abandon any in-flight request when the app goes away.
  useEffect(() => () => abortRef.current?.abort(), [])

  /*
   * Focus management.
   *
   * The result appears below the capture controls, so without this the user's
   * focus stays on the button they pressed and a screen reader user has to
   * hunt for the answer. The container is tabIndex={-1} so it can take
   * programmatic focus without joining the tab order.
   *
   * Both 'result' and 'error' move focus, because a failure is just as much an
   * answer to the button press as a success is.
   *
   * Focus goes to the first heading inside the region rather than the
   * container div itself where one exists: an unlabelled div announces
   * nothing when it receives focus, whereas the heading gives a screen reader
   * user actual content the moment focus lands. The div stays the fallback
   * for the rare case a heading is not there.
   */
  useEffect(() => {
    if (state.status === 'result' || state.status === 'error') {
      const heading = resultRef.current?.querySelector<HTMLElement>('h2')
      ;(heading ?? resultRef.current)?.focus()
    }
  }, [state.status])

  // Forward focus onto "Identify this food" after a successful capture or
  // upload. `image` starts null and only ever becomes truthy (a fresh data
  // URL) on a capture/upload, so this piggybacks on that rather than needing
  // its own state, and naturally skips on first mount. CameraCapture
  // deliberately leaves this transition's focus to us — it doesn't know
  // about this sibling button.
  useEffect(() => {
    if (image) identifyButtonRef.current?.focus()
  }, [image])

  const handleCapture = useCallback((dataUrl: string) => {
    setImage(dataUrl)
    // A new photo invalidates the previous answer — leaving the old result on
    // screen next to a new photo is how someone reads allergens for the wrong
    // dish.
    setState({ status: 'idle' })
  }, [])

  const analyze = useCallback(async () => {
    if (!image) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState({ status: 'loading' })

    try {
      const body: AnalyzeRequest = { image }
      const response = await fetch(`${API_BASE_URL}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const payload: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        // A 429 is the service doing exactly what it is designed to do under
        // load, not a crash — it gets its own honest treatment rather than
        // the generic request-failure wording. See describeRateLimitWait.
        if (response.status === 429) {
          setState({
            status: 'error',
            kind: 'rate-limited',
            message: isApiError(payload) ? payload.error : GENERIC_ERROR,
            retryAfterSeconds: readRetryAfterSeconds(response),
          })
          return
        }
        setState({
          status: 'error',
          kind: 'request-failed',
          message: isApiError(payload) ? payload.error : GENERIC_ERROR,
          retryAfterSeconds: null,
        })
        return
      }

      if (!isAnalyzeResponse(payload)) {
        setState({
          status: 'error',
          kind: 'request-failed',
          message: GENERIC_ERROR,
          retryAfterSeconds: null,
        })
        return
      }

      setState({ status: 'result', data: payload })
    } catch (error) {
      // An abort is a deliberate replacement, not a failure to report.
      if (error instanceof DOMException && error.name === 'AbortError') return
      setState({
        status: 'error',
        kind: 'request-failed',
        message: 'Could not reach the server. Check your connection and try again.',
        retryAfterSeconds: null,
      })
    }
  }, [image])

  /*
   * The screen-reader announcement for the current state.
   *
   * `identified: false` is announced as its own outcome rather than folded in
   * with a successful identification — a user who hears "result ready" and
   * finds a hedge has been misled.
   *
   * Deliberately silent for 'error': the error panel below is `role="alert"`,
   * an assertive live region announced the moment it mounts. Repeating the
   * same message here would fire it twice through two channels — the same
   * "saying it twice is worse than saying it once" reasoning already applied
   * to the loading spinner above.
   */
  let announcement = ''
  if (state.status === 'loading') {
    announcement = 'Identifying your photo. This usually takes a few seconds.'
  } else if (state.status === 'result') {
    announcement = state.data.identified
      ? `Identified as ${state.data.name}. Result below, including allergen information.`
      : 'This photo could not be identified. Suggestions below.'
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>Cultural Food Guide</h1>
        <p className="app__tagline">
          Photograph a dish, a menu or a food label to find out what is in it, what it contains that
          you may need to avoid, and how it is normally eaten.
        </p>
      </header>

      <main className="app__main">
        <CameraCapture onCapture={handleCapture} disabled={state.status === 'loading'} />

        {image ? (
          <div className="actions">
            <button
              ref={identifyButtonRef}
              type="button"
              className="btn btn--primary"
              onClick={() => void analyze()}
              disabled={state.status === 'loading'}
            >
              {state.status === 'loading' ? 'Identifying…' : 'Identify this food'}
            </button>
          </div>
        ) : null}

        {/*
          One polite live region, always in the DOM.

          Assistive technology only reliably announces changes to a live region
          that already existed — a region created at the same moment as its
          content is frequently missed. So the element is permanent and only
          its text changes.
        */}
        <p className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </p>

        {state.status === 'loading' ? (
          // aria-hidden: the live region above already says this, and saying it
          // twice is worse than saying it once.
          <div className="status" aria-hidden="true">
            <span className="spinner" />
            <span>Identifying your photo…</span>
          </div>
        ) : null}

        {/*
          Focus target for both the result and the error. Kept mounted so the
          ref is stable and focus can land the moment the state flips.
        */}
        <div ref={resultRef} tabIndex={-1} className="result-region">
          {state.status === 'error' && state.kind === 'rate-limited' ? (
            // A usage limit, not a fault — `panel--notice` (the same amber
            // treatment as "we could not identify this") rather than
            // `panel--error`, so the visual language does not itself imply
            // something is broken. See describeRateLimitWait for why the
            // wording never blames "our side".
            <div className="panel panel--notice" role="alert">
              {/* tabIndex={-1}: the focus-management effect above focuses
                  the first heading in the region rather than the outer
                  container, since a container div has no accessible name for
                  a screen reader to announce on focus. */}
              {/* Icon in markup, not a CSS ::before, so aria-hidden can keep
                  it out of the announcement — see FoodResult's allergen
                  heading for the reasoning. */}
              <h2 tabIndex={-1}>
                <span aria-hidden="true">ℹ️ </span>
                This service is busy
              </h2>
              <p>{state.message}</p>
              <p>{describeRateLimitWait(state.retryAfterSeconds)}</p>
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void analyze()}
                  disabled={false}
                >
                  Try again
                </button>
              </div>
            </div>
          ) : null}

          {state.status === 'error' && state.kind === 'request-failed' ? (
            <div className="panel panel--error" role="alert">
              {/*
                This is a request FAILURE, not an identification failure. The
                two must not share wording: telling someone to take a clearer
                photo when the server is unreachable sends them retrying
                photographs against a problem no photograph can fix. An honest
                identification failure is handled in FoodResult, where the
                analysis actually ran and returned identified: false.
              */}
              <h2 tabIndex={-1}>Something went wrong</h2>
              <p>{state.message}</p>
              <p>
                This is a problem on our side, not with your photo. Try again in a moment — the same
                photo is fine.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void analyze()}
                  disabled={false}
                >
                  Try again
                </button>
              </div>
            </div>
          ) : null}

          {state.status === 'result' ? <FoodResult result={state.data} /> : null}
        </div>
      </main>

      <footer className="app__footer">
        {/*
          Transparency about the onward transfer, not just our own handling.
          The previous wording said only "sent to our server", which a reader
          would reasonably take to mean the photo stops there. It does not — it
          is forwarded to OpenAI for analysis. Naming the third
          party is the honest disclosure; describing our server alone is not.
        */}
        <p>
          Your photo is sent to our server and then to OpenAI, which analyses it and generates the
          result. Photos are not stored by us and are discarded once the result is returned. No
          account, no location, no tracking.
        </p>
        <p>
          Results are AI-generated and can be wrong. Always check official packaging or ask staff
          before relying on allergen information.
        </p>
      </footer>
    </div>
  )
}

export default App
