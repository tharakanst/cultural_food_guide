/**
 * Tests for EXIF/metadata stripping.
 *
 * `stripExifMetadata` is exercised with hand-built minimal JPEG/PNG buffers
 * rather than real photo fixtures, so each test can assert precisely on which
 * bytes survive. It must never throw and never touch bytes for a shape it
 * doesn't understand — that defensiveness is asserted directly with garbage
 * and non-JPEG/PNG mime types.
 */
import { describe, expect, it } from 'vitest'
import { stripExifMetadata } from './imageSanitizer'

function toBase64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(base64: string): Buffer {
  return Buffer.from(base64, 'base64')
}

// --- JPEG fixtures -----------------------------------------------------

const SOI = [0xff, 0xd8]
const EOI = [0xff, 0xd9]

/** APP0/JFIF segment: marker, length=16 (14 bytes of payload + 2), then payload. */
const APP0_JFIF = [
  0xff,
  0xe0,
  0x00,
  0x10,
  0x4a,
  0x46,
  0x49,
  0x46,
  0x00, // "JFIF\0"
  0x01,
  0x01, // version
  0x00, // units
  0x00,
  0x01, // x density
  0x00,
  0x01, // y density
  0x00,
  0x00, // thumbnail w/h
]

/** APP1/Exif segment carrying a synthetic "Exif" payload with a fake GPS-ish marker. */
function buildApp1Exif(): number[] {
  const payload = [
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00, // "Exif\0\0"
    ...Array.from(Buffer.from('FAKE-GPS-49.28-123.12', 'ascii')),
  ]
  const length = payload.length + 2
  return [0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload]
}

/** Minimal SOS segment: marker, length=8 (6 payload bytes + 2), then payload. */
const SOS = [0xff, 0xda, 0x00, 0x08, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03]

/** Fake entropy-coded scan bytes that follow the SOS header. */
const SCAN_DATA = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]

function buildJpeg(includeApp1: boolean): number[] {
  return [
    ...SOI,
    ...APP0_JFIF,
    ...(includeApp1 ? buildApp1Exif() : []),
    ...SOS,
    ...SCAN_DATA,
    ...EOI,
  ]
}

// --- PNG fixtures -------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function crc32(bytes: number[]): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function buildChunk(type: string, data: number[]): number[] {
  const typeBytes = Array.from(Buffer.from(type, 'ascii'))
  const length = data.length
  const lengthBytes = [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ]
  const crc = crc32([...typeBytes, ...data])
  const crcBytes = [(crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]
  return [...lengthBytes, ...typeBytes, ...data, ...crcBytes]
}

const IHDR_DATA = [
  0x00,
  0x00,
  0x00,
  0x01, // width = 1
  0x00,
  0x00,
  0x00,
  0x01, // height = 1
  0x08, // bit depth
  0x02, // color type
  0x00, // compression
  0x00, // filter
  0x00, // interlace
]

const IHDR_CHUNK = buildChunk('IHDR', IHDR_DATA)
const IEND_CHUNK = buildChunk('IEND', [])
const EXIF_CHUNK = buildChunk('eXIf', Array.from(Buffer.from('FAKE-GPS-EXIF-PAYLOAD', 'ascii')))

function buildPng(includeExif: boolean): number[] {
  return [...PNG_SIGNATURE, ...IHDR_CHUNK, ...(includeExif ? EXIF_CHUNK : []), ...IEND_CHUNK]
}

// --- Tests ---------------------------------------------------------------

describe('stripExifMetadata — JPEG', () => {
  it('removes the APP1/Exif segment while preserving APP0 and the trailing scan data byte-for-byte', () => {
    const withExif = buildJpeg(true)
    const result = fromBase64(stripExifMetadata(toBase64(withExif), 'image/jpeg'))

    // No trace of the dropped APP1 marker+payload.
    const exifMarker = Buffer.from('Exif\0\0', 'ascii')
    expect(result.includes(exifMarker)).toBe(false)
    expect(result.includes(Buffer.from('FAKE-GPS', 'ascii'))).toBe(false)

    // APP0/JFIF segment survives untouched.
    expect(result.subarray(2, 2 + APP0_JFIF.length)).toEqual(Buffer.from(APP0_JFIF))

    // SOS header + scan data + EOI survive byte-for-byte, immediately after APP0.
    const expectedTail = Buffer.from([...SOS, ...SCAN_DATA, ...EOI])
    expect(result.subarray(result.length - expectedTail.length)).toEqual(expectedTail)
  })

  it('is idempotent when there is no APP1/Exif segment present', () => {
    const withoutExif = buildJpeg(false)
    const input = toBase64(withoutExif)
    const result = stripExifMetadata(input, 'image/jpeg')
    expect(result).toBe(input)
  })
})

describe('stripExifMetadata — PNG', () => {
  it('removes the eXIf chunk while preserving IHDR and IEND', () => {
    const withExif = buildPng(true)
    const result = fromBase64(stripExifMetadata(toBase64(withExif), 'image/png'))

    expect(result.includes(Buffer.from('eXIf', 'ascii'))).toBe(false)
    expect(result.includes(Buffer.from('FAKE-GPS-EXIF-PAYLOAD', 'ascii'))).toBe(false)

    const expected = Buffer.from([...PNG_SIGNATURE, ...IHDR_CHUNK, ...IEND_CHUNK])
    expect(result).toEqual(expected)
  })

  it('is idempotent when there is no eXIf chunk present', () => {
    const withoutExif = buildPng(false)
    const input = toBase64(withoutExif)
    const result = stripExifMetadata(input, 'image/png')
    expect(result).toBe(input)
  })
})

describe('stripExifMetadata — defensive passthrough', () => {
  it('leaves image/webp completely unchanged (unhandled by design)', () => {
    const bytes = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]
    const input = toBase64(bytes)
    expect(stripExifMetadata(input, 'image/webp')).toBe(input)
  })

  it('leaves an unsupported mime type unchanged', () => {
    const input = toBase64([0x01, 0x02, 0x03])
    expect(stripExifMetadata(input, 'application/octet-stream')).toBe(input)
  })

  it('leaves malformed bytes claiming to be image/jpeg unchanged and does not throw', () => {
    const garbage = toBase64([0x00, 0x01, 0x02, 0x03, 0x04])
    expect(() => stripExifMetadata(garbage, 'image/jpeg')).not.toThrow()
    expect(stripExifMetadata(garbage, 'image/jpeg')).toBe(garbage)
  })

  it('leaves malformed bytes claiming to be image/png unchanged and does not throw', () => {
    const garbage = toBase64([0x00, 0x01, 0x02, 0x03, 0x04])
    expect(() => stripExifMetadata(garbage, 'image/png')).not.toThrow()
    expect(stripExifMetadata(garbage, 'image/png')).toBe(garbage)
  })

  it('leaves a truncated JPEG (valid SOI, incomplete segment) unchanged', () => {
    const truncated = toBase64([...SOI, 0xff, 0xe0, 0x00])
    expect(() => stripExifMetadata(truncated, 'image/jpeg')).not.toThrow()
    expect(stripExifMetadata(truncated, 'image/jpeg')).toBe(truncated)
  })

  it('leaves a truncated PNG (valid signature, incomplete chunk) unchanged', () => {
    const truncated = toBase64([...PNG_SIGNATURE, 0x00, 0x00, 0x00])
    expect(() => stripExifMetadata(truncated, 'image/png')).not.toThrow()
    expect(stripExifMetadata(truncated, 'image/png')).toBe(truncated)
  })

  it('never throws on an empty payload', () => {
    expect(() => stripExifMetadata('', 'image/jpeg')).not.toThrow()
    expect(() => stripExifMetadata('', 'image/png')).not.toThrow()
    expect(() => stripExifMetadata('', 'image/webp')).not.toThrow()
  })
})
