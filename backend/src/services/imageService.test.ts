/**
 * Tests for Wikimedia reference-image lookup.
 *
 * `validateWikimediaUrl` is pure and exported specifically to be tested — see
 * the module docstring in imageService.ts. It is the last line of defence
 * before an externally-sourced URL reaches an <img src>, so the hostname
 * allowlist (including the suffix-spoof case) is tested exhaustively.
 *
 * `findReferenceImage` is also covered with global fetch mocked; this file
 * must never make a real network call to Wikimedia.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findReferenceImage, validateWikimediaUrl } from './imageService'

describe('validateWikimediaUrl', () => {
  it('accepts the canonical upload host', () => {
    expect(validateWikimediaUrl('https://upload.wikimedia.org/wikipedia/commons/a/b/food.jpg')).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/a/b/food.jpg',
    )
  })

  it('accepts other *.wikimedia.org subdomains', () => {
    expect(validateWikimediaUrl('https://commons.wikimedia.org/wiki/File:Food.jpg')).toBe(
      'https://commons.wikimedia.org/wiki/File:Food.jpg',
    )
  })

  it('is case-insensitive about the hostname', () => {
    expect(validateWikimediaUrl('https://UPLOAD.WIKIMEDIA.ORG/x.jpg')).toBeDefined()
  })

  it('strips tracking query parameters', () => {
    expect(
      validateWikimediaUrl('https://upload.wikimedia.org/x.jpg?utm_source=commons&utm_medium=x'),
    ).toBe('https://upload.wikimedia.org/x.jpg')
  })

  it('strips a hash fragment', () => {
    expect(validateWikimediaUrl('https://upload.wikimedia.org/x.jpg#section')).toBe(
      'https://upload.wikimedia.org/x.jpg',
    )
  })

  it('rejects a suffix-spoofed host (upload.wikimedia.org.attacker.com)', () => {
    expect(validateWikimediaUrl('https://upload.wikimedia.org.attacker.com/evil.jpg')).toBeUndefined()
  })

  it('rejects a host that merely contains "wikimedia.org" as a substring without the dot boundary', () => {
    expect(validateWikimediaUrl('https://evilwikimedia.org/x.jpg')).toBeUndefined()
  })

  it('rejects a completely unrelated host', () => {
    expect(validateWikimediaUrl('https://attacker.example/x.jpg')).toBeUndefined()
  })

  it('rejects non-https URLs', () => {
    expect(validateWikimediaUrl('http://upload.wikimedia.org/x.jpg')).toBeUndefined()
  })

  it('rejects other schemes entirely', () => {
    expect(validateWikimediaUrl('ftp://upload.wikimedia.org/x.jpg')).toBeUndefined()
    expect(validateWikimediaUrl('javascript:alert(1)')).toBeUndefined()
  })

  it('rejects unparseable strings', () => {
    expect(validateWikimediaUrl('not a url at all')).toBeUndefined()
  })

  it('rejects undefined and empty string', () => {
    expect(validateWikimediaUrl(undefined)).toBeUndefined()
    expect(validateWikimediaUrl('')).toBeUndefined()
  })
})

describe('findReferenceImage', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function jsonResponse(body: unknown, ok = true) {
    return { ok, json: async () => body } as Response
  }

  it('returns undefined without calling fetch for an empty dish name', async () => {
    const result = await findReferenceImage('')
    expect(result).toBeUndefined()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns undefined without calling fetch for a whitespace-only dish name', async () => {
    const result = await findReferenceImage('   ')
    expect(result).toBeUndefined()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns the thumbnail URL from a successful lookup', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        query: {
          pages: {
            '123': { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/thumb/x.jpg' }] },
          },
        },
      }),
    )
    const result = await findReferenceImage('Karjalanpiirakka')
    expect(result).toBe('https://upload.wikimedia.org/thumb/x.jpg')
  })

  it('falls back to the full url when thumburl is absent', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        query: { pages: { '123': { imageinfo: [{ url: 'https://upload.wikimedia.org/full.jpg' }] } } },
      }),
    )
    const result = await findReferenceImage('Karjalanpiirakka')
    expect(result).toBe('https://upload.wikimedia.org/full.jpg')
  })

  it('rejects an untrusted URL even if the API itself returned it (defence in depth)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        query: {
          pages: {
            '123': {
              imageinfo: [{ thumburl: 'https://attacker.example/fake.jpg', url: 'https://attacker.example/fake-full.jpg' }],
            },
          },
        },
      }),
    )
    const result = await findReferenceImage('Karjalanpiirakka')
    expect(result).toBeUndefined()
  })

  it('returns undefined when the response is not ok', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, false))
    const result = await findReferenceImage('anything')
    expect(result).toBeUndefined()
  })

  it('returns undefined when there are no pages in the result', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ query: {} }))
    const result = await findReferenceImage('anything')
    expect(result).toBeUndefined()
  })

  it('returns undefined when a page has no imageinfo', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ query: { pages: { '1': {} } } }),
    )
    const result = await findReferenceImage('anything')
    expect(result).toBeUndefined()
  })

  it('returns undefined and does not throw when fetch rejects (network failure or timeout)', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'))
    const result = await findReferenceImage('anything')
    expect(result).toBeUndefined()
  })

  it('returns undefined and does not throw when the response body is not valid JSON', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    } as unknown as Response)
    const result = await findReferenceImage('anything')
    expect(result).toBeUndefined()
  })
})
