import { useCallback, useEffect, useState } from 'react'
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

  const stopSpeaking = useCallback(() => {
    if (!speechSupported()) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [])

  // Never let speech outlive the result on screen. The cleanup runs both on
  // unmount and whenever a new result replaces this one, so the app cannot end
  // up narrating a dish that is no longer displayed.
  useEffect(() => stopSpeaking, [result, stopSpeaking])

  const startSpeaking = useCallback(() => {
    if (!speechSupported() || !recipe || recipe.length === 0) return

    window.speechSynthesis.cancel()

    const spoken = recipe
      .map((step, index) => `Step ${index + 1}. ${step}`)
      .join(' ')

    const utterance = new SpeechSynthesisUtterance(spoken)
    utterance.rate = 0.95 // Slightly slow — the listener is reading in a
    // second language and following along with their hands busy.
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)

    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
  }, [recipe])

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
          <h2>We could not identify this</h2>
          <p>
            The photo could not be matched to a food, product or menu item with
            enough confidence to tell you anything useful about it.
          </p>
          <p>Photos usually work better when:</p>
          <ul className="result__list">
            <li>the label, menu or dish fills most of the frame</li>
            <li>the lighting is even and there is no glare on the packaging</li>
            <li>the text is in focus and the camera is held straight on</li>
          </ul>
          <p>Take another photo and try again.</p>
        </div>
        <p className="disclaimer">{disclaimer}</p>
      </div>
    )
  }

  return (
    <div className="result">
      <div>
        <h2>{name}</h2>
        {description ? <p>{description}</p> : null}
        <ReferenceImage
          url={referenceImageUrl}
          alt={`Photograph of ${name}.`}
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
            No allergen information could be determined from this photo. That is
            not the same as &ldquo;no allergens&rdquo; — check the packaging or
            ask staff before eating this.
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
              re-announce the button label on its own in every browser. */}
          <p className="visually-hidden" role="status">
            {speaking ? 'Reading the recipe steps aloud.' : ''}
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
      <p className="disclaimer">{disclaimer}</p>
    </div>
  )
}

export default FoodResult
