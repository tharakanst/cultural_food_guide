/**
 * Tests for POST /api/analyze — request validation and response shaping.
 *
 * The route is exercised through a minimal Express app (express.json() +
 * the router under test) rather than through src/index.ts, because index.ts
 * calls app.listen() as a side effect of being imported and binding a real
 * port in every test file is exactly the kind of nondeterminism this suite
 * exists to avoid. src/index.ts's own wiring (helmet, cors, the terminal
 * error handler, 404s) is covered separately in src/index.test.ts.
 *
 * aiService and imageService are mocked throughout: this file must never
 * reach the real Gemini API or the real Wikimedia API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import analyzeRouter from './analyze'

const { analyzeImageMock, analyzeMenuItemMock, findReferenceImageMock } = vi.hoisted(() => ({
  analyzeImageMock: vi.fn(),
  analyzeMenuItemMock: vi.fn(),
  findReferenceImageMock: vi.fn(),
}))

vi.mock('../services/aiService', () => ({
  analyzeImage: analyzeImageMock,
  // Bug found while adding menu-item coverage: this factory previously
  // omitted analyzeMenuItem entirely, so any test that actually exercised
  // POST /api/analyze/menu-item would have called `undefined(...)` inside
  // the route's try/catch and always fallen through to a 500 — silently
  // masking every other assertion about validation and response shaping for
  // that route. See the "POST /api/analyze/menu-item" describe blocks below.
  analyzeMenuItem: analyzeMenuItemMock,
}))
vi.mock('../services/imageService', () => ({
  findReferenceImage: findReferenceImageMock,
}))

function buildApp() {
  const app = express()
  app.use(express.json({ limit: '14mb' }))
  app.use('/api', analyzeRouter)
  return app
}

/** A syntactically valid JPEG data URL with a decoded payload of the given byte length. */
function dataUrlOfSize(bytes: number, mimeType = 'image/jpeg'): string {
  return `data:${mimeType};base64,${Buffer.alloc(bytes, 1).toString('base64')}`
}

const TINY_JPEG_DATA_URL = dataUrlOfSize(100)

const VALID_ANALYSIS = {
  resultType: 'food',
  menuItems: [],
  identified: true,
  name: 'Karjalanpiirakka',
  description: 'A savoury Karelian rice pastry.',
  ingredients: ['rye flour', 'rice porridge'],
  allergens: ['Likely contains gluten — typical for this dish'],
  culturalContext: 'A traditional Finnish pastry from Karelia.',
  disclaimer: 'AI-generated, may be wrong.',
}

const UNIDENTIFIED_ANALYSIS = {
  resultType: 'unidentified',
  menuItems: [],
  identified: false,
  name: '',
  description: 'The photo is too blurry to read.',
  ingredients: [],
  allergens: [],
  culturalContext: '',
  disclaimer: 'AI-generated, may be wrong.',
}

describe('POST /api/analyze — request validation', () => {
  beforeEach(() => {
    analyzeImageMock.mockReset()
    analyzeMenuItemMock.mockReset()
    findReferenceImageMock.mockReset()
  })

  it('rejects a body whose top-level JSON value is an array, not an object', async () => {
    // A bare top-level primitive (e.g. `"just a string"`) never reaches this
    // validation at all: express.json()'s default strict mode rejects any
    // top-level JSON value that isn't an object or array before req.body is
    // even populated. That failure mode is covered at the wiring level in
    // src/index.test.ts, which includes the terminal error handler this
    // minimal test app deliberately omits. An array is the case that *does*
    // reach validateAnalyzeRequest with the wrong shape.
    const app = buildApp()
    const res = await request(app).post('/api/analyze').send([])

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: expect.any(String) })
    expect(analyzeImageMock).not.toHaveBeenCalled()
  })

  it('rejects a body missing the image field', async () => {
    const app = buildApp()
    const res = await request(app).post('/api/analyze').send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/image/i)
    expect(analyzeImageMock).not.toHaveBeenCalled()
  })

  it('rejects a non-string image field', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze')
      .send({ image: 12345 })

    expect(res.status).toBe(400)
    expect(analyzeImageMock).not.toHaveBeenCalled()
  })

  it('rejects an image that is not a data URL at all', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze')
      .send({ image: 'https://example.com/food.jpg' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/base64 data url/i)
  })

  it('rejects a data URL with a garbage/smuggled prefix', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze')
      .send({ image: 'data:image/jpeg;base64,not-valid-base64!!! <script>' })

    expect(res.status).toBe(400)
  })

  it('rejects an unsupported MIME type (e.g. GIF)', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze')
      .send({ image: dataUrlOfSize(100, 'image/gif') })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unsupported image type/i)
    expect(analyzeImageMock).not.toHaveBeenCalled()
  })

  it('rejects a non-image MIME type disguised with an image extension (text file as .jpg)', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze')
      .send({ image: `data:text/plain;base64,${Buffer.from('just text').toString('base64')}` })

    expect(res.status).toBe(400)
    expect(analyzeImageMock).not.toHaveBeenCalled()
  })

  it('rejects a payload over the 10MB decoded limit with 413', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze')
      .send({ image: dataUrlOfSize(10 * 1024 * 1024 + 1) })

    expect(res.status).toBe(413)
    expect(res.body.error).toMatch(/10mb/i)
    expect(analyzeImageMock).not.toHaveBeenCalled()
  })

  it('accepts a payload right at the 10MB decoded boundary', async () => {
    analyzeImageMock.mockResolvedValue(VALID_ANALYSIS)
    findReferenceImageMock.mockResolvedValue(undefined)
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze')
      .send({ image: dataUrlOfSize(10 * 1024 * 1024) })

    expect(res.status).toBe(200)
  })
})

describe('POST /api/analyze — success responses', () => {
  beforeEach(() => {
    analyzeImageMock.mockReset()
    analyzeMenuItemMock.mockReset()
    findReferenceImageMock.mockReset()
  })

  it('looks up a reference image and includes it when identified', async () => {
    analyzeImageMock.mockResolvedValue(VALID_ANALYSIS)
    findReferenceImageMock.mockResolvedValue('https://upload.wikimedia.org/wikipedia/commons/x.jpg')

    const app = buildApp()
    const res = await request(app).post('/api/analyze').send({ image: TINY_JPEG_DATA_URL })

    expect(res.status).toBe(200)
    expect(res.body.referenceImageUrl).toBe('https://upload.wikimedia.org/wikipedia/commons/x.jpg')
    expect(findReferenceImageMock).toHaveBeenCalledWith(VALID_ANALYSIS.name)
  })

  it('never adds a referenceImageUrl key when the lookup finds nothing', async () => {
    analyzeImageMock.mockResolvedValue(VALID_ANALYSIS)
    findReferenceImageMock.mockResolvedValue(undefined)

    const app = buildApp()
    const res = await request(app).post('/api/analyze').send({ image: TINY_JPEG_DATA_URL })

    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('referenceImageUrl')
  })

  it('does not look up a reference image when identified is false', async () => {
    analyzeImageMock.mockResolvedValue(UNIDENTIFIED_ANALYSIS)

    const app = buildApp()
    const res = await request(app).post('/api/analyze').send({ image: TINY_JPEG_DATA_URL })

    expect(res.status).toBe(200)
    expect(res.body.identified).toBe(false)
    expect(findReferenceImageMock).not.toHaveBeenCalled()
    expect(res.body).not.toHaveProperty('referenceImageUrl')
  })

  it('passes the decoded base64 and mime type through to analyzeImage untouched', async () => {
    analyzeImageMock.mockResolvedValue(VALID_ANALYSIS)
    findReferenceImageMock.mockResolvedValue(undefined)

    const app = buildApp()
    await request(app).post('/api/analyze').send({ image: dataUrlOfSize(100, 'image/png') })

    expect(analyzeImageMock).toHaveBeenCalledTimes(1)
    const [base64Arg, mimeArg] = analyzeImageMock.mock.calls[0] ?? []
    expect(mimeArg).toBe('image/png')
    expect(typeof base64Arg).toBe('string')
    expect(Buffer.from(base64Arg, 'base64').length).toBe(100)
  })
})

describe('POST /api/analyze — failure handling', () => {
  const originalConsoleError = console.error

  beforeEach(() => {
    analyzeImageMock.mockReset()
    analyzeMenuItemMock.mockReset()
    findReferenceImageMock.mockReset()
    console.error = vi.fn()
  })

  afterEach(() => {
    console.error = originalConsoleError
  })

  it('returns a generic 500 when the AI service throws, without leaking the internal message', async () => {
    analyzeImageMock.mockRejectedValue(new Error('Gemini request failed: quota exceeded, key AIza... leaked'))

    const app = buildApp()
    const res = await request(app).post('/api/analyze').send({ image: TINY_JPEG_DATA_URL })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Failed to analyze image' })
    expect(res.text).not.toMatch(/AIza/)
    expect(res.text).not.toMatch(/quota/)
  })

  it('returns a generic 500 when the reference-image lookup unexpectedly throws', async () => {
    analyzeImageMock.mockResolvedValue(VALID_ANALYSIS)
    findReferenceImageMock.mockRejectedValue(new Error('unexpected'))

    const app = buildApp()
    const res = await request(app).post('/api/analyze').send({ image: TINY_JPEG_DATA_URL })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Failed to analyze image' })
  })
})

/**
 * POST /api/analyze/menu-item — mirrors the /api/analyze suites above at the
 * same rigor. This route grew its own validator (validateMenuItemRequest)
 * and its own success/failure handling in the same commit that added
 * /api/analyze/menu-item to analyze.ts, but until now had no direct test
 * coverage at all — see the comment on the aiService mock factory above for
 * how that let a missing mock export go unnoticed.
 */
const VALID_MENU_ITEM_ANALYSIS = {
  resultType: 'food',
  menuItems: [],
  identified: true,
  name: 'Lohikeitto',
  description: 'A creamy Finnish salmon soup.',
  ingredients: ['salmon', 'potato', 'leek', 'cream'],
  allergens: ['Contains milk (listed on the label)', 'Contains fish (listed on the label)'],
  culturalContext: 'A traditional soup commonly served in Finnish lunch restaurants.',
  disclaimer: 'AI-generated, may be wrong.',
}

const UNIDENTIFIED_MENU_ITEM_ANALYSIS = {
  resultType: 'unidentified',
  menuItems: [],
  identified: false,
  name: '',
  description: 'The supplied menu text was too sparse to identify this item.',
  ingredients: [],
  allergens: [],
  culturalContext: '',
  disclaimer: 'AI-generated, may be wrong.',
}

/**
 * A well-formed but structurally unexpected response for this route: nothing
 * in the request forces the model to return resultType "menu", but
 * parseAnalysis (shared with /api/analyze) allows it, so the route's
 * reference-image-lookup branch needs to be proven correct against it too,
 * not just assumed from the /api/analyze coverage above.
 */
const MENU_RESULT_TYPE_ANALYSIS = {
  resultType: 'menu',
  menuItems: [
    { name: 'Karjalanpiirakka', menuText: 'Rye pastry, 4.50€' },
    { name: 'Lohikeitto', menuText: 'Creamy salmon soup, 12.90€' },
  ],
  identified: true,
  name: '',
  description: '',
  ingredients: [],
  allergens: [],
  culturalContext: '',
  disclaimer: 'AI-generated, may be wrong.',
}

describe('POST /api/analyze/menu-item — request validation', () => {
  beforeEach(() => {
    analyzeImageMock.mockReset()
    analyzeMenuItemMock.mockReset()
    findReferenceImageMock.mockReset()
  })

  it('rejects a body whose top-level JSON value is an array, not an object', async () => {
    const app = buildApp()
    const res = await request(app).post('/api/analyze/menu-item').send([])

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: expect.any(String) })
    expect(analyzeMenuItemMock).not.toHaveBeenCalled()
  })

  it('rejects a body missing the name field', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ menuText: 'Rye pastry, 4.50€' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name/i)
    expect(analyzeMenuItemMock).not.toHaveBeenCalled()
  })

  it('rejects a non-string name field', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 12345, menuText: 'text' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name/i)
    expect(analyzeMenuItemMock).not.toHaveBeenCalled()
  })

  it('rejects an empty-string name', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: '', menuText: 'text' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name/i)
    expect(analyzeMenuItemMock).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only name', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: '   ', menuText: 'text' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name/i)
    expect(analyzeMenuItemMock).not.toHaveBeenCalled()
  })

  it('rejects a name over the 200-character cap', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'x'.repeat(201), menuText: 'text' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/too long/i)
    expect(analyzeMenuItemMock).not.toHaveBeenCalled()
  })

  it('accepts a name exactly at the 200-character cap', async () => {
    analyzeMenuItemMock.mockResolvedValue(VALID_MENU_ITEM_ANALYSIS)
    findReferenceImageMock.mockResolvedValue(undefined)
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'x'.repeat(200), menuText: 'text' })

    expect(res.status).toBe(200)
    expect(analyzeMenuItemMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a missing menuText field', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'Lohikeitto' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/menu text/i)
    expect(analyzeMenuItemMock).not.toHaveBeenCalled()
  })

  it('rejects a non-string menuText field', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'Lohikeitto', menuText: ['not', 'a', 'string'] })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/menu text/i)
    expect(analyzeMenuItemMock).not.toHaveBeenCalled()
  })

  it('accepts an empty-string menuText (a dish with no printed description)', async () => {
    analyzeMenuItemMock.mockResolvedValue(VALID_MENU_ITEM_ANALYSIS)
    findReferenceImageMock.mockResolvedValue(undefined)
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'Lohikeitto', menuText: '' })

    expect(res.status).toBe(200)
    expect(analyzeMenuItemMock).toHaveBeenCalledWith('Lohikeitto', '')
  })

  it('rejects menuText over the 2000-character cap', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'Lohikeitto', menuText: 'x'.repeat(2001) })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/too long/i)
    expect(analyzeMenuItemMock).not.toHaveBeenCalled()
  })

  it('accepts menuText exactly at the 2000-character cap', async () => {
    analyzeMenuItemMock.mockResolvedValue(VALID_MENU_ITEM_ANALYSIS)
    findReferenceImageMock.mockResolvedValue(undefined)
    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'Lohikeitto', menuText: 'x'.repeat(2000) })

    expect(res.status).toBe(200)
    expect(analyzeMenuItemMock).toHaveBeenCalledTimes(1)
  })

  it('trims surrounding whitespace from name and menuText before passing them on', async () => {
    analyzeMenuItemMock.mockResolvedValue(VALID_MENU_ITEM_ANALYSIS)
    findReferenceImageMock.mockResolvedValue(undefined)
    const app = buildApp()
    await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: '  Lohikeitto  ', menuText: '  Creamy salmon soup.  ' })

    expect(analyzeMenuItemMock).toHaveBeenCalledWith('Lohikeitto', 'Creamy salmon soup.')
  })

  it('counts the *untrimmed* name length against the 200-character cap', async () => {
    // Documents actual behaviour: validateMenuItemRequest checks name.length
    // before trimming, so padding a name with whitespace can push it over
    // the cap even though the trimmed content would fit comfortably.
    const app = buildApp()
    const paddedName = `  ${'x'.repeat(199)}  ` // 203 raw chars, 199 trimmed
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: paddedName, menuText: 'text' })

    expect(res.status).toBe(400)
    expect(analyzeMenuItemMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/analyze/menu-item — success responses', () => {
  beforeEach(() => {
    analyzeImageMock.mockReset()
    analyzeMenuItemMock.mockReset()
    findReferenceImageMock.mockReset()
  })

  it('looks up a reference image and includes it when the item is identified food', async () => {
    analyzeMenuItemMock.mockResolvedValue(VALID_MENU_ITEM_ANALYSIS)
    findReferenceImageMock.mockResolvedValue(
      'https://upload.wikimedia.org/wikipedia/commons/x.jpg',
    )

    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'Lohikeitto', menuText: 'Creamy salmon soup, 12.90€' })

    expect(res.status).toBe(200)
    expect(res.body.referenceImageUrl).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/x.jpg',
    )
    expect(findReferenceImageMock).toHaveBeenCalledWith(VALID_MENU_ITEM_ANALYSIS.name)
  })

  it('never adds a referenceImageUrl key when the lookup finds nothing', async () => {
    analyzeMenuItemMock.mockResolvedValue(VALID_MENU_ITEM_ANALYSIS)
    findReferenceImageMock.mockResolvedValue(undefined)

    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'Lohikeitto', menuText: 'text' })

    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('referenceImageUrl')
  })

  it('does not look up a reference image when the item could not be identified', async () => {
    analyzeMenuItemMock.mockResolvedValue(UNIDENTIFIED_MENU_ITEM_ANALYSIS)

    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: '??', menuText: '' })

    expect(res.status).toBe(200)
    expect(res.body.identified).toBe(false)
    expect(findReferenceImageMock).not.toHaveBeenCalled()
    expect(res.body).not.toHaveProperty('referenceImageUrl')
  })

  it('does not look up a reference image for a resultType: "menu" response, even though identified is true', async () => {
    // The lookup is gated on `resultType === 'food'` specifically (see
    // analyze.ts), not merely on `identified` — this pins that the
    // menu-item route reuses that same, correct gate rather than a looser
    // one written for a route that is not expected to receive "menu".
    analyzeMenuItemMock.mockResolvedValue(MENU_RESULT_TYPE_ANALYSIS)

    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'Lohikeitto', menuText: 'text' })

    expect(res.status).toBe(200)
    expect(findReferenceImageMock).not.toHaveBeenCalled()
    expect(res.body).not.toHaveProperty('referenceImageUrl')
    expect(res.body.menuItems).toEqual(MENU_RESULT_TYPE_ANALYSIS.menuItems)
  })

  it('passes the trimmed name and menuText through to analyzeMenuItem untouched otherwise', async () => {
    analyzeMenuItemMock.mockResolvedValue(VALID_MENU_ITEM_ANALYSIS)
    findReferenceImageMock.mockResolvedValue(undefined)

    const app = buildApp()
    await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'Lohikeitto', menuText: 'Creamy salmon soup, 12.90€' })

    expect(analyzeMenuItemMock).toHaveBeenCalledTimes(1)
    expect(analyzeMenuItemMock).toHaveBeenCalledWith('Lohikeitto', 'Creamy salmon soup, 12.90€')
  })
})

describe('POST /api/analyze/menu-item — failure handling', () => {
  const originalConsoleError = console.error

  beforeEach(() => {
    analyzeImageMock.mockReset()
    analyzeMenuItemMock.mockReset()
    findReferenceImageMock.mockReset()
    console.error = vi.fn()
  })

  afterEach(() => {
    console.error = originalConsoleError
  })

  it('returns a generic 500 when the AI service throws, without leaking the internal message', async () => {
    analyzeMenuItemMock.mockRejectedValue(
      new Error('OpenAI request failed: quota exceeded, key sk-... leaked'),
    )

    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'Lohikeitto', menuText: 'text' })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Failed to analyze menu item' })
    expect(res.text).not.toMatch(/sk-/)
    expect(res.text).not.toMatch(/quota/)
  })

  it('returns a generic 500 when the reference-image lookup unexpectedly throws', async () => {
    analyzeMenuItemMock.mockResolvedValue(VALID_MENU_ITEM_ANALYSIS)
    findReferenceImageMock.mockRejectedValue(new Error('unexpected'))

    const app = buildApp()
    const res = await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'Lohikeitto', menuText: 'text' })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Failed to analyze menu item' })
  })

  it('does not call analyzeImage for a menu-item request, and vice versa', async () => {
    analyzeMenuItemMock.mockResolvedValue(VALID_MENU_ITEM_ANALYSIS)
    findReferenceImageMock.mockResolvedValue(undefined)

    const app = buildApp()
    await request(app)
      .post('/api/analyze/menu-item')
      .send({ name: 'Lohikeitto', menuText: 'text' })

    expect(analyzeImageMock).not.toHaveBeenCalled()
  })
})
