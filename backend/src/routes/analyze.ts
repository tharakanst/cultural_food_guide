/**
 * POST /api/analyze — API layer.
 *
 * HTTP, validation, and status codes only. No prompt text, no provider SDK
 * calls, no business logic: validate the input, call the services, shape the
 * response.
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import type { AnalyzeRequest, AnalyzeResponse, MenuItemAnalysisRequest, ApiError } from '../../../shared/types'
import { analyzeImage, analyzeMenuItem } from '../services/aiService'
import { findReferenceImage } from '../services/imageService'

/**
 * Duplicated from the root AGENTS.md shared-constants table rather than
 * imported: shared/types.ts is types-only by design and adding runtime values
 * to it would break its zero-config property. Keep in sync with the frontend.
 */
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB

const MAX_MENU_ITEM_NAME_CHARS = 200
const MAX_MENU_TEXT_CHARS = 2_000

/**
 * data:<mime>;base64,<payload>
 *
 * Anchored, and the payload is restricted to the base64 alphabet, so a
 * malformed or smuggled prefix cannot slip through. Whitespace is not allowed:
 * a well-formed data URL from the browser has none.
 */
const DATA_URL_PATTERN = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/

type ValidationResult =
  | { ok: true; base64: string; mimeType: string }
  | { ok: false; status: number; error: string }

/** Decoded byte length of a base64 string, without allocating the buffer. */
function decodedByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return (base64.length * 3) / 4 - padding
}

/**
 * Validate the request body against AnalyzeRequest.
 *
 * This runs before anything reaches the provider — an unvalidated request that
 * gets as far as OpenAI costs real money on a shared, billed account.
 *
 * Messages describe what the caller got wrong without revealing anything about
 * internals; that is a different thing from the generic message used for
 * server-side failures.
 */
function validateAnalyzeRequest(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, status: 400, error: 'Request body must be a JSON object' }
  }

  const { image } = body as Partial<AnalyzeRequest>

  if (typeof image !== 'string' || image.length === 0) {
    return { ok: false, status: 400, error: 'Request must include an image as a base64 data URL' }
  }

  const match = DATA_URL_PATTERN.exec(image)
  if (!match) {
    return { ok: false, status: 400, error: 'Image must be a base64 data URL' }
  }

  // Both groups are guaranteed by a successful match; the assertion satisfies
  // noUncheckedIndexedAccess without a runtime branch that can never be taken.
  const mimeType = match[1] as string
  const base64 = match[2] as string

  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mimeType)) {
    return {
      ok: false,
      status: 400,
      error: `Unsupported image type. Accepted types: ${ACCEPTED_IMAGE_TYPES.join(', ')}`,
    }
  }

  if (decodedByteLength(base64) > MAX_IMAGE_BYTES) {
    return { ok: false, status: 413, error: 'Image exceeds the 10MB limit' }
  }

  return { ok: true, base64, mimeType }
}

type MenuItemValidationResult =
  | { ok: true; name: string; menuText: string }
  | { ok: false; status: number; error: string }

function validateMenuItemRequest(body: unknown): MenuItemValidationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Request body must be a JSON object' }
  }

  const { name, menuText } = body as Partial<MenuItemAnalysisRequest>

  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, status: 400, error: 'Request must include a menu item name' }
  }

  if (name.length > MAX_MENU_ITEM_NAME_CHARS) {
    return { ok: false, status: 400, error: 'Menu item name is too long' }
  }

  if (typeof menuText !== 'string') {
    return { ok: false, status: 400, error: 'Menu text must be a string' }
  }

  if (menuText.length > MAX_MENU_TEXT_CHARS) {
    return { ok: false, status: 400, error: 'Menu text is too long' }
  }

  return {
    ok: true,
    name: name.trim(),
    menuText: menuText.trim(),
  }
}

const router = Router()

router.post('/analyze', async (req: Request, res: Response<AnalyzeResponse | ApiError>) => {
  const validation = validateAnalyzeRequest(req.body)
  if (!validation.ok) {
    res.status(validation.status).json({ error: validation.error })
    return
  }

  try {
    const analysis = await analyzeImage(validation.base64, validation.mimeType)

    // The reference photo must be a real photograph, never AI-generated, so it
    // is looked up separately and only when there is a dish to look up. A
    // failure here is not a failure of the request.
    const referenceImageUrl =
      analysis.resultType === 'food' && analysis.identified
        ? await findReferenceImage(analysis.name)
        : undefined

    const response: AnalyzeResponse = { ...analysis }
    if (referenceImageUrl) response.referenceImageUrl = referenceImageUrl

    res.status(200).json(response)
  } catch (error) {
    // Server-side only, and deliberately without the image, the model output,
    // or anything derived from user content.
    console.error('[analyze] request failed:', error)
    res.status(500).json({ error: 'Failed to analyze image' })
  }
})

router.post(
  '/analyze/menu-item',
  async (req: Request, res: Response<AnalyzeResponse | ApiError>) => {
    const validation = validateMenuItemRequest(req.body)

    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error })
      return
    }

    try {
      const analysis = await analyzeMenuItem(
        validation.name,
        validation.menuText,
      )

      const referenceImageUrl =
        analysis.resultType === 'food' && analysis.identified
          ? await findReferenceImage(analysis.name)
          : undefined

      const response: AnalyzeResponse = { ...analysis }

      if (referenceImageUrl) {
        response.referenceImageUrl = referenceImageUrl
      }

      res.status(200).json(response)
    } catch (error) {
      console.error('[analyze/menu-item] request failed:', error)

      res.status(500).json({
        error: 'Failed to analyze menu item',
      })
    }
  },
)

export default router
