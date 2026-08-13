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

  const startCamera = useCallback(async () => {
    setMessage(null)

    // Undefined on http:// origins other than localhost, and in browsers with
    // no camera support at all.
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable')
      setMessage(
        'This browser cannot open the camera here. You can still upload a photo.',
      )
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

      // The <video> only exists once status is 'live', so attach on the next
      // frame rather than synchronously.
      queueMicrotask(() => {
        const video = videoRef.current
        if (!video) {
          // Unmounted or re-rendered away while permission was pending.
          stopCamera()
          return
        }
        video.srcObject = stream
        void video.play().catch(() => {
          /* Autoplay refusal is non-fatal; the poster frame still shows. */
        })
      })
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

    const scale = Math.min(
      1,
      MAX_CAPTURE_EDGE / Math.max(video.videoWidth, video.videoHeight),
    )
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
        // The data URL, not the file, is what gets posted — so the size limit
        // is checked against the encoded string.
        if (result.length > MAX_PAYLOAD_BYTES) {
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

      {message ? (
        <p className="camera__hint" role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}

export default CameraCapture
