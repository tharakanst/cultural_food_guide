import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraCapture } from './CameraCapture'

function makeFile(name: string, type: string, contents = 'fake-image-bytes') {
  return new File([contents], name, { type })
}

/**
 * userEvent.upload() filters candidate files against the input's `accept`
 * attribute before it will dispatch a change event, which makes it useless
 * for testing the component's *own* defensive file.type check — that check
 * exists precisely for inputs the accept filter cannot stop (drag-and-drop,
 * an OS "All files" picker, a renamed extension). This bypasses userEvent to
 * simulate exactly that.
 */
function uploadBypassingAcceptFilter(input: HTMLInputElement, file: File) {
  // jsdom has no DataTransfer constructor, and the component only ever reads
  // `input.files?.[0]`, so a plain array stands in for the FileList.
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

describe('CameraCapture — upload path (always available, no mocking required)', () => {
  it('exposes both controls with accessible names', () => {
    render(<CameraCapture onCapture={vi.fn()} />)
    expect(screen.getByRole('button', { name: /use camera/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/upload a photo/i)).toBeInTheDocument()
  })

  it('accepts a valid JPEG upload and calls onCapture with a data URL', async () => {
    const onCapture = vi.fn()
    render(<CameraCapture onCapture={onCapture} />)

    const input = screen.getByLabelText(/upload a photo/i)
    const file = makeFile('lunch.jpg', 'image/jpeg')
    await userEvent.upload(input, file)

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1))
    expect(onCapture.mock.calls[0]?.[0]).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('shows a preview image with descriptive alt text after a successful upload', async () => {
    render(<CameraCapture onCapture={vi.fn()} />)
    await userEvent.upload(screen.getByLabelText(/upload a photo/i), makeFile('a.png', 'image/png'))
    expect(
      await screen.findByRole('img', { name: /the photo you selected, ready to be identified/i }),
    ).toBeInTheDocument()
  })

  it('rejects a non-image file (e.g. a text file) with a clear message and does not call onCapture', async () => {
    const onCapture = vi.fn()
    render(<CameraCapture onCapture={onCapture} />)

    const input = screen.getByLabelText(/upload a photo/i) as HTMLInputElement
    const file = makeFile('notes.txt', 'text/plain')
    uploadBypassingAcceptFilter(input, file)

    expect(await screen.findByRole('status')).toHaveTextContent(/jpeg, png or webp/i)
    expect(onCapture).not.toHaveBeenCalled()
  })

  it('rejects a file with a spoofed image extension but a non-image MIME type', async () => {
    // A text file renamed to .jpg: the browser/File API reports the MIME
    // type it detects, not the extension, but this pins the behaviour when
    // it does not.
    const onCapture = vi.fn()
    render(<CameraCapture onCapture={onCapture} />)
    const input = screen.getByLabelText(/upload a photo/i) as HTMLInputElement
    const file = makeFile('fake.jpg', 'text/plain', 'not actually a jpeg')
    uploadBypassingAcceptFilter(input, file)

    expect(await screen.findByRole('status')).toHaveTextContent(/jpeg, png or webp/i)
    expect(onCapture).not.toHaveBeenCalled()
  })

  it('allows re-selecting the same file twice in a row', async () => {
    const onCapture = vi.fn()
    render(<CameraCapture onCapture={onCapture} />)
    const input = screen.getByLabelText(/upload a photo/i) as HTMLInputElement
    const file = makeFile('lunch.jpg', 'image/jpeg')

    await userEvent.upload(input, file)
    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1))

    await userEvent.upload(input, file)
    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(2))
  })

  it('disables the upload control while an analysis is in flight', () => {
    render(<CameraCapture onCapture={vi.fn()} disabled />)
    expect(screen.getByLabelText(/upload a photo/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /use camera/i })).toBeDisabled()
  })
})

describe('CameraCapture — camera unavailable (no navigator.mediaDevices at all)', () => {
  it('falls back to an "unavailable" message the moment the camera is requested, in a browser/context with no camera support', async () => {
    // This is jsdom's real default (verified: no polyfill installed), not a
    // mock standing in for the no-camera case — see the environment probe in
    // the test-designer report.
    expect(window.navigator.mediaDevices).toBeUndefined()

    const user = userEvent.setup()
    render(<CameraCapture onCapture={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /use camera/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/cannot open the camera here/i)
    // The upload fallback must still be present and usable.
    expect(screen.getByLabelText(/upload a photo/i)).toBeEnabled()
  })
})

describe('CameraCapture — camera permission and lifecycle (navigator.mediaDevices stubbed)', () => {
  let getUserMediaMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getUserMediaMock = vi.fn()
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: getUserMediaMock },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    delete (window.navigator as unknown as { mediaDevices?: unknown }).mediaDevices
  })

  it('shows an "unavailable" message and keeps the upload path working when permission is denied', async () => {
    getUserMediaMock.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))

    const user = userEvent.setup()
    const onCapture = vi.fn()
    render(<CameraCapture onCapture={onCapture} />)

    await user.click(screen.getByRole('button', { name: /use camera/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/permission may have been denied/i)
    expect(screen.getByRole('button', { name: /use camera/i })).toBeInTheDocument()

    // Upload still works after a denied camera permission.
    await userEvent.upload(
      screen.getByLabelText(/upload a photo/i),
      makeFile('a.jpg', 'image/jpeg'),
    )
    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1))
  })

  it('shows an "unavailable" message when no camera device exists (NotFoundError)', async () => {
    getUserMediaMock.mockRejectedValue(
      new DOMException('Requested device not found', 'NotFoundError'),
    )

    const user = userEvent.setup()
    render(<CameraCapture onCapture={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /use camera/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/camera is not available/i)
  })

  it('shows a live preview with capture controls once permission is granted', async () => {
    const stopTrack = vi.fn()
    const fakeStream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream
    getUserMediaMock.mockResolvedValue(fakeStream)

    const user = userEvent.setup()
    render(<CameraCapture onCapture={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /use camera/i }))

    expect(await screen.findByRole('button', { name: /^take photo$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /turn camera off/i })).toBeInTheDocument()
  })

  it('stops all camera tracks when the camera is turned off', async () => {
    const stopTrack = vi.fn()
    const fakeStream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    getUserMediaMock.mockResolvedValue(fakeStream)

    const user = userEvent.setup()
    render(<CameraCapture onCapture={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /use camera/i }))
    await user.click(await screen.findByRole('button', { name: /turn camera off/i }))

    expect(stopTrack).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /use camera/i })).toBeInTheDocument()
  })

  it('stops all camera tracks when the component unmounts mid-session (permission granted then the page navigates away)', async () => {
    const stopTrack = vi.fn()
    const fakeStream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    getUserMediaMock.mockResolvedValue(fakeStream)

    const user = userEvent.setup()
    const { unmount } = render(<CameraCapture onCapture={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /use camera/i }))
    await screen.findByRole('button', { name: /^take photo$/i })

    unmount()
    expect(stopTrack).toHaveBeenCalled()
  })

  it('shows guidance rather than crashing when "Take photo" is pressed before the video has usable dimensions', async () => {
    // jsdom never actually decodes video frames, so videoWidth/videoHeight
    // stay 0 — this is the same state a real camera is briefly in before it
    // has focused, and the app must not crash or silently no-op on it.
    const fakeStream = { getTracks: () => [] } as unknown as MediaStream
    getUserMediaMock.mockResolvedValue(fakeStream)

    const user = userEvent.setup()
    const onCapture = vi.fn()
    render(<CameraCapture onCapture={onCapture} />)
    await user.click(screen.getByRole('button', { name: /use camera/i }))
    await user.click(await screen.findByRole('button', { name: /^take photo$/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/camera is not ready yet/i)
    expect(onCapture).not.toHaveBeenCalled()
  })
})

describe('CameraCapture — oversized file', () => {
  it('rejects a file whose data URL exceeds the 10MB cap and does not call onCapture', async () => {
    const onCapture = vi.fn()
    render(<CameraCapture onCapture={onCapture} />)

    // 8MB of raw bytes — comfortably under the advertised 10MB limit as a
    // real file, used here to build an oversized File cheaply without
    // depending on FileReader's exact base64 inflation ratio for this test's
    // pass/fail condition (that ratio is examined separately below).
    const bigContents = 'x'.repeat(11 * 1024 * 1024)
    const file = makeFile('huge.jpg', 'image/jpeg', bigContents)
    await userEvent.upload(screen.getByLabelText(/upload a photo/i), file)

    expect(await screen.findByRole('status')).toHaveTextContent(/too large/i)
    expect(onCapture).not.toHaveBeenCalled()
  })

  it('accepts a real file between ~7.5MB and 10MB, which base64 inflation previously rejected', async () => {
    // Regression test for comparing the encoded data-URL string length
    // against the backend's *decoded* 10MB limit: base64 inflates by ~33%,
    // so a real 9MB file previously produced a ~12MB data URL that was
    // wrongly rejected, despite being within the advertised 10MB limit and
    // within what the backend actually accepts.
    const onCapture = vi.fn()
    render(<CameraCapture onCapture={onCapture} />)

    const nineMbContents = 'x'.repeat(9 * 1024 * 1024)
    const file = makeFile('phone-photo.jpg', 'image/jpeg', nineMbContents)
    await userEvent.upload(screen.getByLabelText(/upload a photo/i), file)

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
