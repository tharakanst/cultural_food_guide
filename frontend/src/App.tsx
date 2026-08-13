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
const GENERIC_ERROR =
  'Something went wrong while identifying this photo. Please try again.'

type AppState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'result'; data: AnalyzeResponse }

/** Type guard rather than a cast: the response body is untrusted. */
function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiError).error === 'string'
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
   */
  useEffect(() => {
    if (state.status === 'result' || state.status === 'error') {
      resultRef.current?.focus()
    }
  }, [state.status])

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
        setState({
          status: 'error',
          message: isApiError(payload) ? payload.error : GENERIC_ERROR,
        })
        return
      }

      if (!isAnalyzeResponse(payload)) {
        setState({ status: 'error', message: GENERIC_ERROR })
        return
      }

      setState({ status: 'result', data: payload })
    } catch (error) {
      // An abort is a deliberate replacement, not a failure to report.
      if (error instanceof DOMException && error.name === 'AbortError') return
      setState({
        status: 'error',
        message:
          'Could not reach the server. Check your connection and try again.',
      })
    }
  }, [image])

  /*
   * The screen-reader announcement for the current state.
   *
   * `identified: false` is announced as its own outcome rather than folded in
   * with a successful identification — a user who hears "result ready" and
   * finds a hedge has been misled.
   */
  let announcement = ''
  if (state.status === 'loading') {
    announcement = 'Identifying your photo. This usually takes a few seconds.'
  } else if (state.status === 'error') {
    announcement = `Error. ${state.message}`
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
          Photograph a dish, a menu or a food label to find out what is in it,
          what it contains that you may need to avoid, and how it is normally
          eaten.
        </p>
      </header>

      <main className="app__main">
        <CameraCapture
          onCapture={handleCapture}
          disabled={state.status === 'loading'}
        />

        {image ? (
          <div className="actions">
            <button
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
          {state.status === 'error' ? (
            <div className="panel panel--error" role="alert">
              <h2>Could not identify this photo</h2>
              <p>{state.message}</p>
              <p>
                You can try again with the same photo, or take a clearer one.
              </p>
            </div>
          ) : null}

          {state.status === 'result' ? <FoodResult result={state.data} /> : null}
        </div>
      </main>

      <footer className="app__footer">
        <p>
          Photos are sent to our server for identification and are not stored.
          No account, no location, no tracking.
        </p>
      </footer>
    </div>
  )
}

export default App
