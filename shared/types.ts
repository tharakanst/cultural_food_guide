/**
 * Shared API contract between the frontend and backend.
 *
 * This file contains TYPES ONLY, deliberately. TypeScript erases `import type`
 * declarations at compile time, so both sides can import from here with a plain
 * relative path and no build configuration, path aliases, or workspace setup.
 *
 * Adding runtime values (constants, functions) to this file would break that
 * property and require module resolution to be wired up on both sides. Keep
 * runtime values in their own layer.
 *
 * Both sides MUST import from here rather than redeclaring these shapes.
 * A field renamed on one side and not the other is exactly the drift this
 * exists to prevent.
 */

/** POST /api/analyze — request body. */
export interface AnalyzeRequest {
  /**
   * The captured photo as a data URL, e.g. "data:image/jpeg;base64,...".
   * The backend validates the format and size before sending it anywhere.
   */
  image: string
}

/** POST /api/analyze — success response. */
export interface AnalyzeResponse {

  resultType: 'food' | 'menu' | 'unidentified'

  /**
   * False when the image could not be identified as food — unreadable,
   * ambiguous, or not food at all.
   *
   * When false, the other fields may be empty and the frontend must show an
   * honest "could not identify this" state rather than presenting a guess as a
   * result. The project plan commits to showing uncertainty where appropriate;
   * this is that commitment expressed in the type system.
   */
  identified: boolean

  /** The dish or product name, in its local form where one exists. */
  name: string

  /** A short plain-language description of what this food is and tastes like. */
  description: string

  /** Likely ingredients, based on what is visible or typical for the dish. */
  ingredients: string[]

  /**
   * Preparation steps, when the food has a recognisable recipe. Optional
   * because packaged products generally do not have one.
   *
   * This is what the text-to-speech feature reads aloud, so each entry should
   * be a complete, speakable step rather than a fragment.
   */
  recipe?: string[]

  /**
   * Allergens and dietary flags — for example "contains dairy", "contains
   * gluten", "not suitable for vegans".
   *
   * SAFETY-CRITICAL. This drives what a user with an allergy decides to eat.
   * Entries should state uncertainty explicitly ("likely contains dairy") when
   * the model is inferring rather than reading a label. The frontend must never
   * visually de-emphasise this field.
   */
  allergens: string[]

  /** Origin, cultural significance, how it is traditionally eaten or served. */
  culturalContext: string

  /**
   * A real photograph of the dish, sourced from Wikimedia Commons — never
   * AI-generated, per the project plan.
   *
   * Optional and frequently absent: omitted when Wikimedia has no match, or
   * when the returned URL fails the backend's hostname allowlist check. The
   * frontend renders the result without an image rather than showing a broken
   * one.
   */
  referenceImageUrl?: string

  /**
   * A short reminder that this information is AI-generated and does not replace
   * official food labels or professional advice.
   *
   * Always present, always displayed. Required by the project plan's
   * responsible-AI commitments.
   */
  disclaimer: string

  menuItems: MenuItemSource[]

}

/**
 * Error response shape for any failed request.
 *
 * The message is deliberately generic — stack traces, provider errors, and
 * anything revealing internal structure stay in the server log.
 */
export interface ApiError {
  error: string
}

export interface MenuItemSource {
  name: string
  menuText: string
}

export interface MenuItemAnalysisRequest {
  name: string
  menuText: string
}