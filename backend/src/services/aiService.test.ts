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
  resultType: 'food',
  menuItems: [],
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

/**
 * The resultType discriminant is what the menu-item feature actually added
 * to the shared contract (shared/types.ts), and the "food" branch above was
 * already covered before that feature shipped. These describe blocks are the
 * part that needs its own fixture-based rigor: the "menu" and "unidentified"
 * branches, and the field-blanking rules that keep each branch's response
 * honest (a "menu" result must not carry stale single-food fields, an
 * "unidentified" one must not carry a name).
 */
describe('parseAnalysis — resultType: menu', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function importParseAnalysis() {
    const mod = await import('./aiService')
    return mod.parseAnalysis
  }

  const MENU_PAYLOAD = {
    resultType: 'menu',
    menuItems: [
      { name: 'Karjalanpiirakka', menuText: 'Rye pastry, 4.50€' },
      { name: 'Lohikeitto', menuText: 'Creamy salmon soup, 12.90€' },
    ],
    identified: true,
    name: 'should never appear in the result',
    description: 'should be blanked',
    ingredients: ['should be blanked'],
    allergens: ['should be blanked'],
    culturalContext: 'should be blanked',
    disclaimer: 'AI-generated, may be wrong.',
  }

  it('extracts menuItems and blanks every single-food field', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(JSON.stringify(MENU_PAYLOAD))

    expect(result.resultType).toBe('menu')
    expect(result.menuItems).toEqual(MENU_PAYLOAD.menuItems)
    expect(result.identified).toBe(true)
    expect(result.name).toBe('')
    expect(result.description).toBe('')
    expect(result.ingredients).toEqual([])
    expect(result.allergens).toEqual([])
    expect(result.culturalContext).toBe('')
  })

  it('demotes identified to false when the model claims a menu but menuItems is empty', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(
      JSON.stringify({ ...MENU_PAYLOAD, menuItems: [], identified: true }),
    )
    expect(result.identified).toBe(false)
  })

  it('throws when "menuItems" itself is not an array', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() =>
      parseAnalysis(JSON.stringify({ ...MENU_PAYLOAD, menuItems: 'not an array' })),
    ).toThrow(/"menuItems".*array/)
  })

  it('throws when a menu item entry is not an object (e.g. a bare string)', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() =>
      parseAnalysis(JSON.stringify({ ...MENU_PAYLOAD, menuItems: ['Karjalanpiirakka'] })),
    ).toThrow(/menuItems\[0\]/)
  })

  it('throws when a menu item entry is an array rather than a plain object', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() =>
      parseAnalysis(JSON.stringify({ ...MENU_PAYLOAD, menuItems: [['Karjalanpiirakka']] })),
    ).toThrow(/menuItems\[0\]/)
  })

  it('throws when a menu item is missing "menuText"', async () => {
    // Note: requireMenuItems delegates each field to the shared requireString
    // helper, whose message names the field ("menuText") but not which
    // array index it came from — unlike the "not an object" and "empty
    // name" checks a few lines down in aiService.ts, which do include
    // `menuItems[i]`. Harmless (this never reaches the client — the route
    // turns any thrown error into a generic 500), but a minor inconsistency
    // in the server log message worth knowing about if this ever needs
    // debugging against a real malformed response.
    const parseAnalysis = await importParseAnalysis()
    const badItems = [{ name: 'Karjalanpiirakka' }]
    expect(() =>
      parseAnalysis(JSON.stringify({ ...MENU_PAYLOAD, menuItems: badItems })),
    ).toThrow(/"menuText".*must be a string/)
  })

  it('throws when a menu item is missing "name"', async () => {
    const parseAnalysis = await importParseAnalysis()
    const badItems = [{ menuText: 'Rye pastry, 4.50€' }]
    expect(() =>
      parseAnalysis(JSON.stringify({ ...MENU_PAYLOAD, menuItems: badItems })),
    ).toThrow(/"name".*must be a string/)
  })

  it('throws when a menu item field has the wrong type', async () => {
    const parseAnalysis = await importParseAnalysis()
    const badItems = [{ name: 'Karjalanpiirakka', menuText: 42 }]
    expect(() =>
      parseAnalysis(JSON.stringify({ ...MENU_PAYLOAD, menuItems: badItems })),
    ).toThrow(/"menuText".*must be a string.*got number/)
  })

  it('throws when a menu item has an empty (or whitespace-only) name', async () => {
    const parseAnalysis = await importParseAnalysis()
    const badItems = [{ name: '   ', menuText: 'text' }]
    expect(() =>
      parseAnalysis(JSON.stringify({ ...MENU_PAYLOAD, menuItems: badItems })),
    ).toThrow(/menuItems\[0\]\.name/)
  })

  it('allows a menu item with an empty menuText (no printed description)', async () => {
    const parseAnalysis = await importParseAnalysis()
    const items = [{ name: 'Karjalanpiirakka', menuText: '' }]
    const result = parseAnalysis(JSON.stringify({ ...MENU_PAYLOAD, menuItems: items }))
    expect(result.menuItems).toEqual([{ name: 'Karjalanpiirakka', menuText: '' }])
  })

  it('trims whitespace from each menu item field', async () => {
    const parseAnalysis = await importParseAnalysis()
    const items = [{ name: '  Karjalanpiirakka  ', menuText: '  Rye pastry.  ' }]
    const result = parseAnalysis(JSON.stringify({ ...MENU_PAYLOAD, menuItems: items }))
    expect(result.menuItems).toEqual([{ name: 'Karjalanpiirakka', menuText: 'Rye pastry.' }])
  })
})

describe('parseAnalysis — resultType: unidentified', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function importParseAnalysis() {
    const mod = await import('./aiService')
    return mod.parseAnalysis
  }

  const UNIDENTIFIED_PAYLOAD = {
    resultType: 'unidentified',
    menuItems: [],
    // Deliberately incoherent with resultType, the way a misbehaving model
    // response could be: the parser must not trust this rather than the
    // resultType branch.
    identified: true,
    name: 'should never appear in the result',
    description: 'The supplied menu text was too sparse to identify this item.',
    ingredients: ['should be blanked'],
    allergens: ['should be blanked'],
    culturalContext: 'should be blanked',
    disclaimer: 'AI-generated, may be wrong.',
  }

  it('forces identified to false regardless of what the model claimed', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(JSON.stringify(UNIDENTIFIED_PAYLOAD))
    expect(result.identified).toBe(false)
  })

  it('keeps the description (the failure explanation) but blanks every other food-detail field', async () => {
    const parseAnalysis = await importParseAnalysis()
    const result = parseAnalysis(JSON.stringify(UNIDENTIFIED_PAYLOAD))

    expect(result.description).toBe(
      'The supplied menu text was too sparse to identify this item.',
    )
    expect(result.name).toBe('')
    expect(result.ingredients).toEqual([])
    expect(result.allergens).toEqual([])
    expect(result.culturalContext).toEqual('')
    expect(result.menuItems).toEqual([])
  })
})

describe('parseAnalysis — invalid or missing resultType', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function importParseAnalysis() {
    const mod = await import('./aiService')
    return mod.parseAnalysis
  }

  it('throws when resultType is not one of food/menu/unidentified', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() => parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, resultType: 'drink' }))).toThrow(
      /"resultType"/,
    )
  })

  it('throws when resultType is missing entirely', async () => {
    const parseAnalysis = await importParseAnalysis()
    const { resultType: _drop, ...rest } = VALID_PAYLOAD
    expect(() => parseAnalysis(JSON.stringify(rest))).toThrow(/"resultType"/)
  })

  it('throws when resultType has the wrong type', async () => {
    const parseAnalysis = await importParseAnalysis()
    expect(() => parseAnalysis(JSON.stringify({ ...VALID_PAYLOAD, resultType: 3 }))).toThrow(
      /"resultType"/,
    )
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

/**
 * analyzeMenuItem has its own, separately implemented request/response
 * handling (not a thin wrapper around analyzeImage — see aiService.ts), and
 * until now had no direct test coverage at all: every fixture and mock above
 * this point only ever imports and calls analyzeImage. Mirrors the
 * analyzeImage suite above 1:1 so the same rigor applies to both entry
 * points into the provider.
 */
describe('analyzeMenuItem', () => {
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
    const { analyzeMenuItem } = await import('./aiService')
    await expect(analyzeMenuItem('Karjalanpiirakka', 'Rye pastry.')).rejects.toThrow(
      /OPENAI_API_KEY/,
    )
  })

  it('returns a parsed analysis on a normal successful call', async () => {
    createMock.mockResolvedValue(choiceWith())
    const { analyzeMenuItem } = await import('./aiService')
    const result = await analyzeMenuItem('Karjalanpiirakka', 'Rye pastry.')
    expect(result.name).toBe('Karjalanpiirakka')
  })

  it('sends the dish name and menu text as the user turn, targets the menu-item schema, and never sends an image', async () => {
    createMock.mockResolvedValue(choiceWith())
    const { analyzeMenuItem } = await import('./aiService')
    await analyzeMenuItem('Karjalanpiirakka', 'Rye pastry, 4.50€')

    expect(createMock).toHaveBeenCalledTimes(1)
    const request = createMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: unknown }>
      response_format: { json_schema: { name: string } }
    }

    expect(request.messages).toHaveLength(2)
    expect(request.messages[0]?.role).toBe('system')
    expect(request.messages[1]).toEqual({
      role: 'user',
      content: JSON.stringify({ name: 'Karjalanpiirakka', menuText: 'Rye pastry, 4.50€' }),
    })
    expect(request.response_format.json_schema.name).toBe('menu_item_analysis')
    // No image_url content anywhere in the request — this route never
    // receives or forwards a photo.
    expect(JSON.stringify(request)).not.toMatch(/image_url/)
  })

  it('wraps a provider-level failure (network, timeout, quota) in a generic transport error', async () => {
    createMock.mockRejectedValue(new Error('ECONNRESET'))
    const { analyzeMenuItem } = await import('./aiService')
    await expect(analyzeMenuItem('Karjalanpiirakka', 'text')).rejects.toThrow(
      /OpenAI request failed/,
    )
  })

  it('throws when the response was withheld by the content filter', async () => {
    createMock.mockResolvedValue(
      choiceWith({ finish_reason: 'content_filter', message: { content: null, refusal: null } }),
    )
    const { analyzeMenuItem } = await import('./aiService')
    await expect(analyzeMenuItem('Karjalanpiirakka', 'text')).rejects.toThrow(/stopped early/)
  })

  it('throws when there are no choices', async () => {
    createMock.mockResolvedValue({ choices: [] })
    const { analyzeMenuItem } = await import('./aiService')
    await expect(analyzeMenuItem('Karjalanpiirakka', 'text')).rejects.toThrow(/no choices/)
  })

  it('throws when the model stops early (e.g. length from a long thinking response)', async () => {
    createMock.mockResolvedValue(
      choiceWith({ finish_reason: 'length', message: { content: null, refusal: null } }),
    )
    const { analyzeMenuItem } = await import('./aiService')
    await expect(analyzeMenuItem('Karjalanpiirakka', 'text')).rejects.toThrow(/stopped early/)
  })

  it('throws a clean error, without echoing the refusal text, when the model refuses', async () => {
    createMock.mockResolvedValue(
      choiceWith({
        message: { content: null, refusal: 'I will not help with that menu item.' },
      }),
    )
    const { analyzeMenuItem } = await import('./aiService')
    await expect(analyzeMenuItem('Karjalanpiirakka', 'text')).rejects.toThrow(/refused/i)
    await expect(analyzeMenuItem('Karjalanpiirakka', 'text')).rejects.not.toThrow(
      /will not help with that menu item/i,
    )
  })

  it('throws when the message has neither usable content nor a refusal', async () => {
    createMock.mockResolvedValue(choiceWith({ message: { content: null, refusal: null } }))
    const { analyzeMenuItem } = await import('./aiService')
    await expect(analyzeMenuItem('Karjalanpiirakka', 'text')).rejects.toThrow(/no usable text/)
  })

  it('propagates a parseAnalysis failure when the model text is not valid JSON', async () => {
    createMock.mockResolvedValue(
      choiceWith({ message: { content: 'Sorry, I cannot help with that.', refusal: null } }),
    )
    const { analyzeMenuItem } = await import('./aiService')
    await expect(analyzeMenuItem('Karjalanpiirakka', 'text')).rejects.toThrow(/not valid json/i)
  })

  it('propagates a parseAnalysis failure when a required field is missing from the model output', async () => {
    const { identified: _drop, ...incomplete } = VALID_PAYLOAD
    createMock.mockResolvedValue(
      choiceWith({ message: { content: JSON.stringify(incomplete), refusal: null } }),
    )
    const { analyzeMenuItem } = await import('./aiService')
    await expect(analyzeMenuItem('Karjalanpiirakka', 'text')).rejects.toThrow(/"identified"/)
  })

  it('propagates a parseAnalysis failure when a field has the wrong type', async () => {
    createMock.mockResolvedValue(
      choiceWith({
        message: {
          content: JSON.stringify({ ...VALID_PAYLOAD, ingredients: 'not an array' }),
          refusal: null,
        },
      }),
    )
    const { analyzeMenuItem } = await import('./aiService')
    await expect(analyzeMenuItem('Karjalanpiirakka', 'text')).rejects.toThrow(
      /"ingredients".*array/,
    )
  })

  it('returns an honest unidentified result, without throwing, when the supplied menu text is too sparse', async () => {
    const sparse = {
      resultType: 'unidentified',
      menuItems: [],
      identified: false,
      name: '',
      description: 'Not enough information was supplied to identify this item.',
      ingredients: [],
      allergens: [],
      culturalContext: '',
      disclaimer: 'AI-generated, may be wrong.',
    }
    createMock.mockResolvedValue(
      choiceWith({ message: { content: JSON.stringify(sparse), refusal: null } }),
    )
    const { analyzeMenuItem } = await import('./aiService')
    const result = await analyzeMenuItem('??', '')
    expect(result.identified).toBe(false)
    expect(result.resultType).toBe('unidentified')
  })
})
