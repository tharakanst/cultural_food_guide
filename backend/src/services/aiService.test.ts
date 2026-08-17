/**
 * Tests for the AI service layer.
 *
 * `parseAnalysis` is pure and exported specifically to be tested without
 * spending OpenAI quota — see the OWNERSHIP note in aiService.ts. Most of
 * this file exercises it directly with hand-written fixtures standing in for
 * every way a model can misbehave: fenced JSON, prose wrapping, malformed
 * JSON, missing/wrong-typed fields, and an invented referenceImageUrl.
 *
 * `analyzeImage` is also covered, with the `openai` SDK fully mocked — this
 * file must never reach the real OpenAI API.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
}))

vi.mock('openai', () => {
  // A plain function, not an arrow function: aiService.ts calls this with
  // `new`, and arrow functions cannot be constructors.
  const OpenAI = vi.fn().mockImplementation(function OpenAI() {
    return { chat: { completions: { create: createMock } } }
  })
  return { default: OpenAI, OpenAI }
})

const VALID_PAYLOAD = {
  identified: true,
  name: 'Karjalanpiirakka',
  description: 'A savoury Karelian rice pastry.',
  ingredients: ['rye flour', 'rice porridge', 'butter'],
  allergens: ['Likely contains gluten — typical for this dish'],
  culturalContext: 'A traditional Finnish pastry from Karelia.',
  disclaimer: 'AI-generated, may be wrong.',
}

describe('parseAnalysis', () => {
  // Reset modules between tests so nothing here depends on import order.
  beforeEach(() => {
    vi.resetModules()
  })

  async function importParseAnalysis() {
    const mod = await import('./aiService')
    return mod.parseAnalysis
  }

  it('parses plain JSON', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(JSON.stringify(VALID_PAYLOAD))
    expect(result.identified).toBe(true)
    expect(result.name).toBe('Karjalanpiirakka')
    expect(result.ingredients).toEqual(['rye flour', 'rice porridge', 'butter'])
  })

  it('parses JSON wrapped in a ```json fence', async () => {
    const parseAnalysis = await importParseAnalysis()
    const text = '```json\n' + JSON.stringify(VALID_PAYLOAD) + '\n```'
    const result = parseAnalysis(text)
    expect(result.name).toBe('Karjalanpiirakka')
  })

  it('parses JSON wrapped in a bare fence with no language tag', async () => {
    const parseAnalysis = await importParseAnalysis()
    const text = '```\n' + JSON.stringify(VALID_PAYLOAD) + '\n```'
    const result = parseAnalysis(text)
    expect(result.name).toBe('Karjalanpiirakka')
  })

  it('strips leading prose before the JSON object', async () => {
    const parseAnalysis = await importParseAnalysis()
    const text = 'Sure, here is the analysis:\n' + JSON.stringify(VALID_PAYLOAD)
    const result = parseAnalysis(text)
    expect(result.name).toBe('Karjalanpiirakka')
  })

  it('strips trailing commentary after the JSON object', async () => {
    const parseAnalysis = await importParseAnalysis()
    const text = JSON.stringify(VALID_PAYLOAD) + '\nLet me know if you need anything else!'
    const result = parseAnalysis(text)
    expect(result.name).toBe('Karjalanpiirakka')
  })

  it('unwraps a single object mistakenly wrapped in an array', async () => {
    const parseAnalysis = await importParseAnalysis()
    const text = JSON.stringify([VALID_PAYLOAD])
    const result = parseAnalysis(text)
    expect(result.name).toBe('Karjalanpiirakka')
  })

  it('throws a clean error for an array of non-objects (no braces to salvage)', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() => parseAnalysis('[1, 2, 3]')).toThrow(/must be a json object/i)
  })

  it('throws a clean error for malformed JSON', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() => parseAnalysis('{ this is not json ')).toThrow(/not valid json/i)
  })

  it('throws for an empty response', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() => parseAnalysis('')).toThrow(/empty/i)
  })

  it('throws for a whitespace-only response', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() => parseAnalysis('   \n  ')).toThrow(/empty/i)
  })

  it('throws when the top-level JSON value is a string, not an object', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() => parseAnalysis('"hello"')).toThrow(/must be a json object/i)
  })

  it('throws when the top-level JSON value is a number', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() => parseAnalysis('42')).toThrow(/must be a json object/i)
  })

  it('throws when "identified" is missing', async () => {
    const parseAnalysis = await importParseAnalysis()
    const { identified: _drop, ...rest } = VALID_PAYLOAD
    expect(() => parseAnalysis(JSON.stringify(rest))).toThrow(/"identified"/)
  })

  it('throws when "identified" has the wrong type', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() => parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, identified: 'yes' }))).toThrow(
      /"identified"/,
    )
  })

  it('throws when a required string field is missing', async () => {
    const parseAnalysis = await importParseAnalysis()
    const { name: _drop, ...rest } = VALID_PAYLOAD
    expect(() => parseAnalysis(JSON.stringify(rest))).toThrow(/"name"/)
  })

  it('throws when "ingredients" is a string instead of an array', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() =>
      parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, ingredients: 'rice, pastry' })),
    ).toThrow(/"ingredients".*array/)
  })

  it('throws when an array field contains a non-string entry', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() =>
      parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, ingredients: ['rice', 42] })),
    ).toThrow(/ingredients\[1\]/)
  })

  it('demotes a claimed identification with an empty name to identified: false', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, identified: true, name: '' }))
    expect(result.identified).toBe(false)
  })

  it('demotes a claimed identification with a whitespace-only name to identified: false', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, identified: true, name: '   ' }))
    expect(result.identified).toBe(false)
  })

  it('omits recipe from the result when absent from the model output', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(JSON.stringify(VALID_PAYLOAD))
    expect(result).not.toHaveProperty('recipe')
  })

  it('treats a null recipe the same as an absent one', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, recipe: null }))
    expect(result).not.toHaveProperty('recipe')
  })

  it('treats an empty recipe array as no recipe (key omitted)', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, recipe: [] }))
    expect(result).not.toHaveProperty('recipe')
  })

  it('keeps a populated recipe and drops blank steps', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(
      JSON.stringify({ ...VALID_PAYLOAD, recipe: ['Preheat the oven.', '   ', 'Bake for 20 minutes.'] }),
    )
    expect(result.recipe).toEqual(['Preheat the oven.', 'Bake for 20 minutes.'])
  })

  it('throws when recipe is present but not an array', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() => parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, recipe: 'Step one.' }))).toThrow(
      /"recipe".*array/,
    )
  })

  it('falls back to the default disclaimer when the model omits it', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, disclaimer: '' }))
    expect(result.disclaimer.length).toBeGreaterThan(0)
    expect(result.disclaimer).toMatch(/AI-generated/i)
  })

  it('strips a model-invented referenceImageUrl instead of passing it through', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(
      JSON.stringify({ ...VALID_PAYLOAD, referenceImageUrl: 'https://attacker.example/pwned.jpg' }),
    )
    expect(result).not.toHaveProperty('referenceImageUrl')
  })

  it('drops unknown fields entirely, not just referenceImageUrl', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, extraField: 'unexpected' }))
    expect(result).not.toHaveProperty('extraField')
  })

  it('trims whitespace from string fields', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, name: '  Karjalanpiirakka  ' }))
    expect(result.name).toBe('Karjalanpiirakka')
  })

  it('allows an empty allergens array when identified is true (still parses, does not fabricate)', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, allergens: [] }))
    expect(result.allergens).toEqual([])
  })

  it('handles a very large ingredients array without truncating entries', async () => {
    const parseAnalysis = await importParseAnalysis()
    const manyIngredients = Array.from({ length: 500 }, (_, i) => `ingredient-${i}`)
    const result = parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, ingredients: manyIngredients }))
    expect(result.ingredients).toHaveLength(500)
    expect(result.ingredients[499]).toBe('ingredient-499')
  })
})

describe('analyzeImage', () => {
  beforeEach(() => {
    vi.resetModules()
    createMock.mockReset()
    process.env.OPENAI_API_KEY = 'test-key'
  })

  function choiceWith(overrides: Record<string, unknown> = {}) {
    return {
      choices: [
        {
          finish_reason: 'stop',
          message: { content: JSON.stringify(VALID_PAYLOAD), refusal: null },
          ...overrides,
        },
      ],
    }
  }

  it('throws a descriptive error when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY
    const { analyzeImage } = await import('./aiService')
    await expect(analyzeImage('base64==', 'image/jpeg')).rejects.toThrow(/OPENAI_API_KEY/)
  })

  it('returns a parsed analysis on a normal successful call', async () => {
    createMock.mockResolvedValue(choiceWith())
    const { analyzeImage } = await import('./aiService')
    const result = await analyzeImage('base64==', 'image/jpeg')
    expect(result.name).toBe('Karjalanpiirakka')
  })

  it('wraps a provider-level failure (network, timeout, quota) in a generic transport error', async () => {
    createMock.mockRejectedValue(new Error('ECONNRESET'))
    const { analyzeImage } = await import('./aiService')
    await expect(analyzeImage('base64==', 'image/jpeg')).rejects.toThrow(/OpenAI request failed/)
  })

  it('throws when the response was withheld by the content filter', async () => {
    createMock.mockResolvedValue(
      choiceWith({ finish_reason: 'content_filter', message: { content: null, refusal: null } }),
    )
    const { analyzeImage } = await import('./aiService')
    await expect(analyzeImage('base64==', 'image/jpeg')).rejects.toThrow(/stopped early/)
  })

  it('throws when there are no choices', async () => {
    createMock.mockResolvedValue({ choices: [] })
    const { analyzeImage } = await import('./aiService')
    await expect(analyzeImage('base64==', 'image/jpeg')).rejects.toThrow(/no choices/)
  })

  it('throws when the model stops early (e.g. length from a long thinking response)', async () => {
    createMock.mockResolvedValue(
      choiceWith({ finish_reason: 'length', message: { content: null, refusal: null } }),
    )
    const { analyzeImage } = await import('./aiService')
    await expect(analyzeImage('base64==', 'image/jpeg')).rejects.toThrow(/stopped early/)
  })

  it('throws a clean error, without echoing the refusal text, when the model refuses', async () => {
    createMock.mockResolvedValue(
      choiceWith({
        message: { content: null, refusal: 'I cannot help with that image.' },
      }),
    )
    const { analyzeImage } = await import('./aiService')
    await expect(analyzeImage('base64==', 'image/jpeg')).rejects.toThrow(/refused/i)
    await expect(analyzeImage('base64==', 'image/jpeg')).rejects.not.toThrow(
      /cannot help with that image/i,
    )
  })

  it('throws when the message has neither usable content nor a refusal', async () => {
    createMock.mockResolvedValue(choiceWith({ message: { content: null, refusal: null } }))
    const { analyzeImage } = await import('./aiService')
    await expect(analyzeImage('base64==', 'image/jpeg')).rejects.toThrow(/no usable text/)
  })

  it('propagates a parseAnalysis failure when the model text is not valid JSON', async () => {
    createMock.mockResolvedValue(
      choiceWith({ message: { content: 'Sorry, I cannot help with that.', refusal: null } }),
    )
    const { analyzeImage } = await import('./aiService')
    await expect(analyzeImage('base64==', 'image/jpeg')).rejects.toThrow(/not valid json/i)
  })
})
