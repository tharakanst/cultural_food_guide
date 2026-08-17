import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

/**
 * Kept in sync with the backend by hand — see the "Shared constants" table in
 * the root AGENTS.md. They live here rather than in shared/types.ts because
 * that file is types-only by design and runtime values would break it.
 */
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024

/** Longest edge of a captured frame. Keeps the base64 payload well inside the
 *  10 MB limit and the upload fast on a phone connection. */
const MAX_CAPTURE_EDGE = 1600

/**
 * The decoded byte length of a base64 data URL.
 *
 * `dataUrl.length` (the encoded string length) is NOT the same quantity as
 * MAX_PAYLOAD_BYTES, which is the backend's *decoded* limit — base64 inflates
 * a payload by about a third, so comparing the encoded string length against
 * the decoded limit rejects real files above roughly 7.5MB even though they
 * are within the advertised 10MB and within what the backend accepts.
 */
function decodedDataUrlByteLength(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

type CameraStatus =
  /** Camera not requested yet. */
  | 'idle'
  /** Waiting on the permission prompt / device. */
  | 'starting'
  /** Preview is running. */
  | 'live'
  /** Permission denied, no camera, or an insecure context. Upload still works. */
  | 'unavailable'

interface CameraCaptureProps {
  /** Called with a data URL, e.g. "data:image/jpeg;base64,...". */
  onCapture: (dataUrl: string) => void
  /** True while an analysis is in flight. */
  disabled?: boolean
}

/**
 * Photo input: live rear-facing camera preview where it is available, and a
 * file upload that always works.
 *
 * The upload path is not a degraded fallback — camera permission is denied
 * often enough that it has to be a first-class way to use the app, and it is
 * the only path that works on a desktop browser with no camera.
 */
export function CameraCapture({ onCapture, disabled = false }: CameraCaptureProps) {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // The action buttons below are two structurally different element sets at
  // the same position: 'live' renders "Take photo" / "Turn camera off",
  // every other status renders "Use camera". React unmounts whichever one
  // was focused on every transition between them, dropping a keyboard user's
  // focus to <body>. These refs, plus the effect below, move focus onto the
  // replacement deliberately instead of leaving it to fall away — see
  // App.tsx's resultRef for the same pattern.
  const takePhotoButtonRef = useRef<HTMLButtonElement | null>(null)
  const useCameraButtonRef = useRef<HTMLButtonElement | null>(null)
  const isFirstRender = useRef(true)

  /*
   * Set when leaving 'live' because a photo was successfully captured, as
   * opposed to the camera being turned off or becoming unavailable.
   *
   * All three transitions land on status 'idle', but they mean opposite things
   * for focus: after turning the camera off, "Use camera" is the sensible place
   * to be, while after a successful capture the user is finished with the
   * camera and the next control is "Identify this food". Pulling focus back to
   * "Use camera" there sends them backwards past the button they now want.
   */
  const capturedRef = useRef(false)

  /** Releases the camera. Safe to call repeatedly. */
  const stopCamera = useCallback(() => {
    const stream = streamRef.current
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  // Release the camera when the component goes away. Without this the phone
  // keeps the "camera in use" indicator lit after navigating away.
  useEffect(() => stopCamera, [stopCamera])

  /*
   * Attach the live stream to the <video> once React has actually rendered it.
   *
   * This must be an effect rather than something scheduled from startCamera:
   * effects run after the DOM commit, so the element is guaranteed to exist.
   * Doing it any earlier means videoRef.current is still null.
   *
   * `muted` is set as a property as well as an attribute — some browsers
   * evaluate autoplay eligibility from the property, and a stream that is not
   * considered muted can have play() rejected, leaving a black frame.
   */
  useEffect(() => {
    if (status !== 'live') return
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream) return

    video.srcObject = stream
    video.muted = true

    // play() can reject (autoplay refused) or throw synchronously (jsdom has no
    // implementation, and some browsers throw rather than returning a promise).
    // Neither is fatal — the stream is already attached and capture still works
    // — but an uncaught throw here would take the whole component down.
    try {
      const playback = video.play() as Promise<void> | undefined
      void playback?.catch(() => {})
    } catch {
      /* No playback support; the attached stream is what matters. */
    }
  }, [status])

  // Deliberate focus target for every status transition (see the comment on
  // the refs above). Skipped on first mount so opening the page does not
  // steal focus onto "Use camera" before the user has done anything.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (status === 'live') {
      takePhotoButtonRef.current?.focus()
      return
    }
    // A successful capture also lands here, but the user has finished with the
    // camera — "Identify this food" has just appeared and is what they want
    // next. Leave focus where it is rather than dragging it backwards, and let
    // the natural tab order carry them forward.
    if (capturedRef.current) {
      capturedRef.current = false
      return
    }
    useCameraButtonRef.current?.focus()
  }, [status])

  const startCamera = useCallback(async () => {
    setMessage(null)

    // Undefined on http:// origins other than localhost, and in browsers with
    // no camera support at all.
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable')
      setMessage('This browser cannot open the camera here. You can still upload a photo.')
      return
    }

    setStatus('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // 'environment' opens the rear camera on a phone, which is the one
        // pointed at the menu or the packet.
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })

      streamRef.current = stream
      setStatus('live')
      setPreview(null)

      // Attaching the stream to the <video> happens in the effect below, not
      // here. The element does not exist until React has rendered status
      // 'live', and a microtask queued at this point runs BEFORE that commit —
      // so videoRef.current is still null, and the old code treated that as
      // "unmounted" and stopped the camera it had just started. The result was
      // live controls above a permanently blank preview.
    } catch {
      // Deliberately not surfacing the DOMException name: for the user the
      // outcome is identical, and the upload path is the answer either way.
      stopCamera()
      setStatus('unavailable')
      setMessage(
        'The camera is not available — permission may have been denied. You can upload a photo instead.',
      )
    }
  }, [stopCamera])

  const capturePhoto = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      setMessage('The camera is not ready yet. Try again in a moment.')
      return
    }

    const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)

    const context = canvas.getContext('2d')
    if (!context) {
      setMessage('This browser could not process the photo. Try uploading one instead.')
      return
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)

    // Release the camera as soon as we have the frame — nothing needs it after
    // this, and holding it drains the battery and keeps the indicator lit.
    stopCamera()
    // Tells the focus effect this transition to 'idle' was a success, not the
    // camera being switched off, so focus is not dragged back to "Use camera".
    capturedRef.current = true
    setStatus('idle')
    setPreview(dataUrl)
    onCapture(dataUrl)
  }, [onCapture, stopCamera])

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget
      const file = input.files?.[0]

      // Allow the same file to be chosen twice in a row; without this the
      // change event does not fire the second time.
      input.value = ''

      if (!file) return

      if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
        setMessage('Please choose a JPEG, PNG or WebP image.')
        return
      }

      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result
        if (typeof result !== 'string') {
          setMessage('That file could not be read. Try another photo.')
          return
        }
        // MAX_PAYLOAD_BYTES is the backend's *decoded* limit, so the encoded
        // data URL is decoded back to real byte count before comparing —
        // comparing the encoded string's length would reject real files
        // above ~7.5MB despite them being within the advertised 10MB.
        if (decodedDataUrlByteLength(result) > MAX_PAYLOAD_BYTES) {
          setMessage('That image is too large. Please choose one under 10 MB.')
          return
        }
        setMessage(null)
        // A file was chosen while the camera was running; it wins.
        stopCamera()
        setStatus('idle')
        setPreview(result)
        onCapture(result)
      }
      reader.onerror = () => {
        setMessage('That file could not be read. Try another photo.')
      }
      reader.readAsDataURL(file)
    },
    [onCapture, stopCamera],
  )

  return (
    <section className="camera" aria-labelledby="camera-heading">
      <h2 id="camera-heading">Take or choose a photo</h2>

      {status === 'live' ? (
        <div className="camera__viewport">
          <video
            ref={videoRef}
            className="camera__video"
            playsInline
            muted
            autoPlay
            // The live feed carries no information a screen reader user can
            // act on, and the capture button below is the actual control.
            aria-hidden="true"
          />
        </div>
      ) : null}

      {preview ? (
        <img
          className="camera__preview"
          src={preview}
          alt="The photo you selected, ready to be identified."
        />
      ) : null}

      <div className="actions">
        {status === 'live' ? (
          <>
            <button
              ref={takePhotoButtonRef}
              type="button"
              className="btn btn--primary"
              onClick={capturePhoto}
              disabled={disabled}
            >
              Take photo
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                stopCamera()
                setStatus('idle')
              }}
            >
              Turn camera off
            </button>
          </>
        ) : (
          <button
            ref={useCameraButtonRef}
            type="button"
            className="btn"
            onClick={() => void startCamera()}
            disabled={disabled || status === 'starting'}
          >
            {status === 'starting' ? 'Opening camera…' : 'Use camera'}
          </button>
        )}

        {/*
          Keyboard accessibility of the upload control.

          The <input type="file"> is `.visually-hidden` — clipped, but still
          rendered, still in the tab order and still in the accessibility tree.
          `display: none` or `visibility: hidden` would remove it from both and
          leave the control unreachable by keyboard, since a <label> is not
          focusable and cannot stand in for it.

          The label is the visible target and carries
          `:focus-within { outline: ... }`, so when the clipped input takes
          focus the ring is painted on the thing the user can actually see.
        */}
        <label className="upload-control">
          Upload a photo
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            onChange={handleFileChange}
            disabled={disabled}
          />
        </label>
      </div>

      {/*
        Permanently mounted, with only its text changing — never conditionally
        rendered.

        Assistive technology reliably announces changes to a live region that
        already existed; a region created at the same moment as its content is
        frequently missed. This one carries real content — "camera not
        available", "please choose a JPEG, PNG or WebP", "image too large" — so
        a user who denies camera permission or picks an oversized file would
        otherwise hear nothing at all. App.tsx and FoodResult.tsx already use
        this pattern; this component was the exception.

        `:empty` in the stylesheet collapses the padding when there is nothing
        to say, so the permanent element costs no visual space.
      */}
      <p className="camera__hint" role="status" aria-live="polite">
        {message ?? ''}
      </p>
    </section>
  )
}

export default CameraCapture
