import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnalyzeResponse } from '../../../shared/types'
import { ReferenceImage } from './ReferenceImage'

interface FoodResultProps {
  result: AnalyzeResponse
}

/** True only where the browser actually exposes speech synthesis. jsdom and
 *  older mobile browsers do not, and the control is hidden rather than broken
 *  in that case. */
function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Longest alt text this app will produce before truncating. A screen reader
 *  reads the whole alt attribute aloud; a 300-character alt is its own
 *  accessibility problem, so this stays short enough to be useful. */
const MAX_ALT_DESCRIPTION_LENGTH = 150

/**
 * Builds meaningful alt text for the reference photo by folding in the
 * dish's `description`, rather than the bare "Photograph of {name}." — which
 * tells a screen-reader user nothing the visible heading two lines above
 * did not already say, when the whole point of the image is to let them
 * cross-check what is in front of them against the identified dish.
 *
 * Truncated at a sentence boundary where one exists within the limit, so the
 * alt text never trails off mid-word.
 */
function referenceImageAlt(name: string, description: string): string {
  const trimmed = description.trim()
  if (!trimmed) return `Photograph of ${name}.`

  if (trimmed.length <= MAX_ALT_DESCRIPTION_LENGTH) {
    return `Photograph of ${name}: ${trimmed}`
  }

  const truncated = trimmed.slice(0, MAX_ALT_DESCRIPTION_LENGTH)
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('! '),
    truncated.lastIndexOf('? '),
  )
  const lastSpace = truncated.lastIndexOf(' ')
  const cut =
    lastSentenceEnd > MAX_ALT_DESCRIPTION_LENGTH * 0.4
      ? truncated.slice(0, lastSentenceEnd + 1)
      : `${truncated.slice(0, lastSpace > 0 ? lastSpace : truncated.length)}…`

  return `Photograph of ${name}: ${cut}`
}

/**
 * Renders an /api/analyze response.
 *
 * Everything here comes from model output, which itself comes from a
 * photograph of arbitrary real-world text. It is rendered as text through
 * React's default escaping — never with dangerouslySetInnerHTML.
 */
export function FoodResult({ result }: FoodResultProps) {
  const {
    identified,
    name,
    description,
    ingredients,
    recipe,
    allergens,
    culturalContext,
    referenceImageUrl,
    disclaimer,
  } = result

  const [speaking, setSpeaking] = useState(false)
  const canSpeak = speechSupported()

  /*
   * The TTS live-region announcement.
   *
   * A separate piece of state from `speaking`, rather than deriving the text
   * directly from it: the original version showed text only while speaking
   * was true and reverted to '' the instant it stopped, so stopping or
   * finishing was never announced at all — the author's own comment already
   * noted AT will not reliably re-read a toggled button label, but that
   * reasoning was only applied to the start case. `isSpeakingRef` tracks
   * whether speech is actually in progress, independently of React state, so
   * the various stop paths (button, cleanup, onend, onerror) can each decide
   * whether a "stopped" announcement is actually warranted.
   */
  const [ttsAnnouncement, setTtsAnnouncement] = useState('')
  const isSpeakingRef = useRef(false)
  const announcementTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  const announceTts = useCallback((text: string, autoClearMs?: number) => {
    if (announcementTimeoutRef.current !== null) {
      window.clearTimeout(announcementTimeoutRef.current)
      announcementTimeoutRef.current = null
    }
    setTtsAnnouncement(text)
    // Cleared after a few seconds rather than left indefinitely — a stale
    // "Stopped reading" announcement sitting in the live region forever is
    // its own confusion for anyone who opens a screen reader's virtual
    // cursor and lands on it later.
    if (autoClearMs) {
      announcementTimeoutRef.current = window.setTimeout(() => {
        setTtsAnnouncement('')
        announcementTimeoutRef.current = null
      }, autoClearMs)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (announcementTimeoutRef.current !== null) {
        window.clearTimeout(announcementTimeoutRef.current)
      }
    }
  }, [])

  const stopSpeaking = useCallback(() => {
    if (!speechSupported()) return
    const wasSpeaking = isSpeakingRef.current
    window.speechSynthesis.cancel()
    isSpeakingRef.current = false
    setSpeaking(false)
    if (wasSpeaking) {
      announceTts('Stopped reading.', 4000)
    }
  }, [announceTts])

  // Never let speech outlive the result on screen. The cleanup runs both on
  // unmount and whenever a new result replaces this one, so the app cannot end
  // up narrating a dish that is no longer displayed.
  useEffect(() => stopSpeaking, [result, stopSpeaking])

  const startSpeaking = useCallback(() => {
    if (!speechSupported() || !recipe || recipe.length === 0) return

    window.speechSynthesis.cancel()

    const spoken = recipe.map((step, index) => `Step ${index + 1}. ${step}`).join(' ')

    const utterance = new SpeechSynthesisUtterance(spoken)
    utterance.rate = 0.95 // Slightly slow — the listener is reading in a
    // second language and following along with their hands busy.
    utterance.onend = () => {
      isSpeakingRef.current = false
      setSpeaking(false)
      announceTts('Finished reading the recipe steps.', 4000)
    }
    utterance.onerror = () => {
      isSpeakingRef.current = false
      setSpeaking(false)
      announceTts('Reading stopped due to an error.', 4000)
    }

    window.speechSynthesis.speak(utterance)
    isSpeakingRef.current = true
    setSpeaking(true)
    announceTts('Reading the recipe steps aloud.')
  }, [recipe, announceTts])

  /*
   * The honest "could not identify this" state.
   *
   * This lives here, in the only component that renders a result, so there is
   * no code path anywhere that can present an unidentified guess as a
   * confirmed answer. The name, ingredients and allergens are deliberately not
   * shown: when `identified` is false the API contract says those fields may
   * be empty or speculative, and speculative allergen data is worse than none.
   */
  if (!identified) {
    return (
      <div className="result">
        <div className="panel panel--notice">
          {/* tabIndex={-1}: App's focus-management effect focuses the first
              heading inside the result region rather than the container div,
              since an unlabelled div announces nothing to a screen reader on
              focus. */}
          <h2 tabIndex={-1}>
            <span aria-hidden="true">ℹ️ </span>
            We could not identify this
          </h2>
          <p>
            The photo could not be matched to a food, product or menu item with enough confidence to
            tell you anything useful about it.
          </p>
          <p>Photos usually work better when:</p>
          <ul className="result__list">
            <li>the label, menu or dish fills most of the frame</li>
            <li>the lighting is even and there is no glare on the packaging</li>
            <li>the text is in focus and the camera is held straight on</li>
          </ul>
          <p>Take another photo and try again.</p>
        </div>
        <p className="disclaimer">
        <span aria-hidden="true">ℹ️ </span>
        {disclaimer}
      </p>
      </div>
    )
  }

  return (
    <div className="result">
      <div>
        {/* tabIndex={-1}: App's focus-management effect focuses the first
            heading inside the result region rather than the container div,
            since an unlabelled div announces nothing to a screen reader on
            focus. */}
        <h2 tabIndex={-1}>{name}</h2>
        {description ? <p>{description}</p> : null}
        <ReferenceImage
          url={referenceImageUrl}
          alt={referenceImageAlt(name, description)}
          caption="Reference photograph from Wikimedia Commons."
        />
      </div>

      {/*
        Allergens come first among the detail sections and sit in a bordered,
        full-contrast panel at normal body size. Safety-critical content is
        never the smallest or faintest thing on the screen — see
        frontend/AGENTS.md.
      */}
      <section className="allergens" aria-labelledby="allergens-heading">
        <h3 id="allergens-heading" className="allergens__heading">
          {/*
            The warning icon is markup rather than a CSS ::before so it can be
            hidden from assistive technology — aria-hidden cannot be applied to
            a pseudo-element. Screen readers announce emoji inconsistently
            ("warning sign emoji", or nothing, depending on the engine), and
            this heading is the one place where a stray announcement lands
            exactly when someone is listening for allergen information.
          */}
          <span aria-hidden="true">⚠️ </span>
          Allergens and dietary information
        </h3>
        {allergens.length > 0 ? (
          <ul className="allergens__list">
            {allergens.map((allergen, index) => (
              <li key={`${index}-${allergen}`}>{allergen}</li>
            ))}
          </ul>
        ) : (
          <p>
            No allergen information could be determined from this photo. That is not the same as
            &ldquo;no allergens&rdquo; — check the packaging or ask staff before eating this.
          </p>
        )}
      </section>

      {ingredients.length > 0 ? (
        <section className="result__section" aria-labelledby="ingredients-heading">
          <h3 id="ingredients-heading">Ingredients</h3>
          <ul className="result__list">
            {ingredients.map((ingredient, index) => (
              <li key={`${index}-${ingredient}`}>{ingredient}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {recipe && recipe.length > 0 ? (
        <section className="result__section" aria-labelledby="recipe-heading">
          <h3 id="recipe-heading">How it is made</h3>

          {canSpeak ? (
            <div className="actions">
              <button
                type="button"
                className="btn"
                aria-pressed={speaking}
                onClick={speaking ? stopSpeaking : startSpeaking}
              >
                {speaking ? 'Stop reading' : 'Read the steps aloud'}
              </button>
            </div>
          ) : null}

          {/* State change announced explicitly: a screen reader will not
              re-announce the button label on its own in every browser. This
              covers starting AND stopping/finishing — see announceTts. */}
          <p className="visually-hidden" role="status" aria-live="polite">
            {ttsAnnouncement}
          </p>

          <ol className="result__list result__list--ordered">
            {recipe.map((step, index) => (
              <li key={`${index}-${step}`}>{step}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {culturalContext ? (
        <section className="result__section" aria-labelledby="context-heading">
          <h3 id="context-heading">Cultural context</h3>
          <p>{culturalContext}</p>
        </section>
      ) : null}

      {/* Always rendered — a responsible-AI commitment from the project plan,
          not a conditional nicety. */}
      <p className="disclaimer">
        <span aria-hidden="true">ℹ️ </span>
        {disclaimer}
      </p>
    </div>
  )
}

export default FoodResult
