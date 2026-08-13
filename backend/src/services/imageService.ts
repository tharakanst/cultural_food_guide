/**
 * Wikimedia Commons reference image lookup.
 *
 * Finds a real photograph of an identified dish. No API key is required.
 *
 * Everything this module returns is untrusted third-party data that ends up in
 * an `<img src>` on the frontend, so the URL is validated against a hostname
 * allowlist before it leaves here. A missing image is a minor degradation; an
 * attacker-controlled URL rendered in an image tag is not.
 *
 * Plain async function, plain arguments, plain return value — no Express types,
 * so it can be tested without an HTTP server.
 */

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

/** Give up rather than hold an API request open on a slow third party. */
const REQUEST_TIMEOUT_MS = 5000

/** Wikimedia file namespace — restricts the search to media pages. */
const FILE_NAMESPACE = '6'

/** Width of the thumbnail we ask Commons to render, in pixels. */
const THUMBNAIL_WIDTH = '800'

/**
 * Shape of the slice of the MediaWiki response we use. Declared locally and
 * treated as unverified: every field is optional because the API is free to
 * omit any of them.
 */
interface CommonsSearchResponse {
  query?: {
    pages?: Record<
      string,
      {
        imageinfo?: Array<{ thumburl?: string; url?: string }>
      }
    >
  }
}

/**
 * Validate a URL from an external API against a hostname allowlist.
 *
 * Allowlist, not blocklist: anything that is not provably a Wikimedia upload
 * host is rejected.
 *
 * @returns The URL when it passes every check, otherwise undefined.
 */
export function validateWikimediaUrl(candidate: string | undefined): string | undefined {
  if (typeof candidate !== 'string' || candidate.length === 0) return undefined

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    // Unparseable — reject.
    return undefined
  }

  if (parsed.protocol !== 'https:') return undefined

  const host = parsed.hostname.toLowerCase()
  const isAllowedHost = host === 'upload.wikimedia.org' || host.endsWith('.wikimedia.org')
  if (!isAllowedHost) return undefined

  // Commons appends utm_* tracking parameters to imageinfo URLs. Nothing in the
  // query string is needed to fetch the image, and dropping it means no
  // third-party-controlled data survives into the frontend's <img src>.
  parsed.search = ''
  parsed.hash = ''

  return parsed.toString()
}

/**
 * Look up a reference photograph for a dish on Wikimedia Commons.
 *
 * Never throws and never logs the dish name: the name originates from a
 * photograph the user took, so it counts as user content.
 *
 * @param dishName The identified dish or product name.
 * @returns A validated https Wikimedia URL, or undefined if there is no usable
 *   match, the lookup fails, or the returned URL fails validation.
 */
export async function findReferenceImage(dishName: string): Promise<string | undefined> {
  const query = typeof dishName === 'string' ? dishName.trim() : ''
  if (query.length === 0) return undefined

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '1',
    // `generator=search` finds matching File: pages, then `prop=imageinfo`
    // resolves each one to an actual media URL in the same round trip.
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: FILE_NAMESPACE,
    gsrlimit: '1',
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: THUMBNAIL_WIDTH,
  })

  try {
    const response = await fetch(`${COMMONS_API}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        // Wikimedia asks API clients to identify themselves.
        'User-Agent': 'CulturalFoodGuide/1.0 (INF2335 coursework project)',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) return undefined

    const data = (await response.json()) as CommonsSearchResponse
    const pages = data.query?.pages
    if (!pages) return undefined

    for (const page of Object.values(pages)) {
      const info = page?.imageinfo?.[0]
      if (!info) continue

      // Prefer the rendered thumbnail — full-size Commons originals are
      // routinely tens of megabytes, which is not what a phone should download.
      const validated = validateWikimediaUrl(info.thumburl) ?? validateWikimediaUrl(info.url)
      if (validated) return validated
    }

    return undefined
  } catch {
    // Network failure, timeout, or malformed JSON. A reference image is
    // optional, so degrade silently rather than failing the whole analysis.
    // Deliberately no logging here: the only context worth logging would be the
    // dish name, which is user content.
    return undefined
  }
}
