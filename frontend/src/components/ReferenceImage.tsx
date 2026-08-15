import { useEffect, useState } from 'react'

interface ReferenceImageProps {
  /**
   * `AnalyzeResponse.referenceImageUrl`. Optional in the API contract and
   * frequently absent — the backend omits it when Wikimedia has no match or
   * the URL fails its hostname allowlist check.
   */
  url: string | undefined

  /**
   * REQUIRED, and deliberately not optional and not defaulted.
   *
   * TypeScript rejects `<ReferenceImage url={x} />` at compile time, so an
   * image with no alt text cannot be shipped by accident. Describe the dish,
   * not the file — "A bowl of creamy salmon soup with dill and potato", not
   * "reference image".
   */
  alt: string

  /** Optional visible attribution line, e.g. the Wikimedia source. */
  caption?: string
}



/**
 * Renders a reference photograph of the dish, or nothing at all.
 *
 * Two absent cases, both of which render nothing rather than a broken image
 * icon: the URL was never provided, and the URL was provided but failed to
 * load (dead Wikimedia link, offline, blocked).
 */
export function ReferenceImage({ url, alt, caption }: ReferenceImageProps) {
  const [failed, setFailed] = useState(false)

  // A new URL deserves a fresh attempt; without this the component would stay
  // in the failed state after the user analyses a second photo.
  useEffect(() => {
    setFailed(false)
  }, [url])

  if (!url || failed) {
    return null
  }

  return (
    <figure className="reference-figure">
      <img
        src={url}
        alt={alt}
        className="reference-figure__img"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
      {caption ? (
        <figcaption className="reference-image__caption">{caption}</figcaption>
      ) : null}
    </figure>
  )
}

export default ReferenceImage
