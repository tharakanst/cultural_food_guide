/**
 * EXIF/metadata stripping for uploaded images.
 *
 * The live-camera capture path re-encodes through `<canvas>` on the frontend,
 * which strips EXIF as a side effect. The file-upload fallback path does not —
 * `handleFileChange` reads the original file bytes directly, so a photo chosen
 * via "Upload a photo" can carry its original EXIF block (GPS coordinates,
 * device make/model, timestamp) through to the provider unmodified. That is in
 * tension with the "no location... is collected or stored" claims in
 * AGENTS.md, README.md, and docs/project-plan.md. This module closes that gap
 * on the backend, defensively, regardless of which upload path a photo came
 * through.
 *
 * `image/jpeg`: walks marker segments after the SOI and drops any APP1
 * segment (0xFFE1) — that's where EXIF lives — leaving every other segment
 * untouched. Stops parsing at SOS (0xFFDA) and copies the remaining
 * scan/image data through unchanged.
 *
 * `image/png`: walks chunks after the 8-byte signature and drops any `eXIf`
 * chunk, leaving every other chunk untouched.
 *
 * Anything else — including `image/webp` and any buffer that does not match
 * the expected JPEG/PNG structure — is returned unchanged. This is
 * deliberately defensive: it must never throw and never corrupt image bytes
 * it doesn't fully understand. A best-effort strip that misses metadata is a
 * privacy gap worth fixing later; a corrupted image sent to the provider is
 * a broken request right now.
 *
 * Never logs the image bytes, matching the "no logging of user content"
 * stance in aiService.ts and imageService.ts.
 */

const JPEG_APP1 = 0xe1
const JPEG_SOS = 0xda
// Markers with no length field: TEM (0x01), RST0-RST7 (0xD0-0xD7), EOI (0xD9).
function isStandaloneMarker(markerCode: number): boolean {
  return markerCode === 0x01 || markerCode === 0xd9 || (markerCode >= 0xd0 && markerCode <= 0xd7)
}

/**
 * Strip APP1 (EXIF) segments from a JPEG buffer.
 *
 * @returns The stripped buffer, or the original buffer unchanged if the input
 *   does not look like a well-formed JPEG.
 */
function stripJpegExif(buffer: Buffer): Buffer {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer

  const chunks: Buffer[] = [buffer.subarray(0, 2)] // SOI
  let offset = 2

  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) return buffer // Not a marker where one was expected — bail out.

    const markerCode = buffer[offset + 1] as number

    if (isStandaloneMarker(markerCode)) {
      chunks.push(buffer.subarray(offset, offset + 2))
      offset += 2
      continue
    }

    if (offset + 3 >= buffer.length) return buffer // Truncated length field.

    const length = buffer.readUInt16BE(offset + 2)
    const segmentEnd = offset + 2 + length
    if (length < 2 || segmentEnd > buffer.length) return buffer // Malformed length.

    if (markerCode === JPEG_SOS) {
      // Keep the SOS segment header itself, then copy the remaining
      // scan/image data (entropy-coded bytes, RST markers, EOI, ...) through
      // unchanged without further marker parsing.
      chunks.push(buffer.subarray(offset, segmentEnd))
      chunks.push(buffer.subarray(segmentEnd))
      return Buffer.concat(chunks)
    }

    if (markerCode !== JPEG_APP1) {
      chunks.push(buffer.subarray(offset, segmentEnd))
    }
    // APP1 segments (EXIF) are dropped by simply not pushing them.

    offset = segmentEnd
  }

  // Ran off the end without hitting SOS — not a shape we understand well
  // enough to trust a partial rewrite of. Return the original unchanged.
  return buffer
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_EXIF_CHUNK_TYPE = 'eXIf'
const PNG_CHUNK_OVERHEAD = 12 // 4-byte length + 4-byte type + 4-byte CRC

/**
 * Strip eXIf chunks from a PNG buffer.
 *
 * @returns The stripped buffer, or the original buffer unchanged if the input
 *   does not look like a well-formed PNG.
 */
function stripPngExif(buffer: Buffer): Buffer {
  if (
    buffer.length < PNG_SIGNATURE.length ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return buffer
  }

  const chunks: Buffer[] = [buffer.subarray(0, PNG_SIGNATURE.length)]
  let offset = PNG_SIGNATURE.length

  while (offset < buffer.length) {
    if (offset + PNG_CHUNK_OVERHEAD > buffer.length) return buffer // Truncated chunk header/CRC.

    const dataLength = buffer.readUInt32BE(offset)
    const chunkEnd = offset + PNG_CHUNK_OVERHEAD + dataLength
    if (chunkEnd > buffer.length) return buffer // Malformed length.

    const type = buffer.toString('ascii', offset + 4, offset + 8)

    if (type !== PNG_EXIF_CHUNK_TYPE) {
      chunks.push(buffer.subarray(offset, chunkEnd))
    }

    offset = chunkEnd
  }

  return Buffer.concat(chunks)
}

// WebP EXIF (stored in a RIFF "EXIF" chunk) is intentionally unhandled here —
// stripping it correctly requires recomputing the outer RIFF container size,
// which is more risk than this pass takes on. Falls through to the
// unchanged-passthrough branch below; not an oversight.

/**
 * Strip EXIF/location metadata from an image, defensively.
 *
 * Never throws. For any mime type or byte layout this function does not fully
 * understand, it returns the input unchanged rather than risk corrupting the
 * image.
 *
 * @param base64 The base64-encoded image payload (no data URL prefix).
 * @param mimeType The image's declared mime type.
 * @returns A base64-encoded image payload with EXIF metadata removed where
 *   supported, otherwise identical to the input.
 */
export function stripExifMetadata(base64: string, mimeType: string): string {
  try {
    const input = Buffer.from(base64, 'base64')

    let output: Buffer
    if (mimeType === 'image/jpeg') {
      output = stripJpegExif(input)
    } else if (mimeType === 'image/png') {
      output = stripPngExif(input)
    } else {
      // image/webp and anything else: unhandled by design, see comment above.
      output = input
    }

    return output.toString('base64')
  } catch {
    // Never let a malformed/unexpected buffer take the request down; fall
    // back to the original payload unchanged.
    return base64
  }
}
