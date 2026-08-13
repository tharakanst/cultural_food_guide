import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { AnalyzeResponse } from '../../shared/types'

function uploadFile(input: HTMLElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

function jpegFile() {
  return new File(['fake-bytes'], 'lunch.jpg', { type: 'image/jpeg' })
}

async function uploadAndWaitForButton() {
  const user = userEvent.setup()
  render(<App />)
  uploadFile(screen.getByLabelText(/upload a photo/i), jpegFile())
  const button = await screen.findByRole('button', { name: /identify this food/i })
  return { user, button }
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

const identifiedResult: AnalyzeResponse = {
  identified: true,
  name: 'Karjalanpiirakka',
  description: 'A savoury Karelian rice pastry.',
  ingredients: ['rye flour', 'rice porridge'],
  allergens: ['Likely contains gluten — typical for this dish'],
  culturalContext: 'A traditional Finnish pastry from Karelia.',
  disclaimer: 'This information is AI-generated and may be wrong.',
}

const unidentifiedResult: AnalyzeResponse = {
  identified: false,
  name: '',
  description: 'The photo is too blurry to read.',
  ingredients: [],
  allergens: [],
  culturalContext: '',
  disclaimer: 'This information is AI-generated and may be wrong.',
}

describe('App — basic rendering', () => {
  it('renders the app heading', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 1, name: /cultural food guide/i }),
    ).toBeInTheDocument()
  })

  it('keeps the file input labelled and focusable', () => {
    render(<App />)
    const input = screen.getByLabelText(/upload a photo/i)
    input.focus()
    expect(input).toHaveFocus()
  })

  it('does not show the "Identify this food" button until a photo has been chosen', () => {
    render(<App />)
    expect(screen.queryByRole('button', { name: /identify this food/i })).not.toBeInTheDocument()
  })
})

describe('App — analyze flow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a loading announcement while the request is in flight, then the result', async () => {
    let resolveFetch!: (value: Response) => void
    vi.mocked(fetch).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )

    const { user, button } = await uploadAndWaitForButton()
    await user.click(button)

    expect(await screen.findByRole('status')).toHaveTextContent(/identifying your photo/i)

    resolveFetch(jsonResponse(identifiedResult))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' }),
    ).toBeInTheDocument()
  })

  it('moves focus to the result heading once a result arrives (screen reader users are not left behind)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(identifiedResult))
    const { user, button } = await uploadAndWaitForButton()
    await user.click(button)

    // Focus lands on the heading itself, not the unlabelled container div —
    // a screen reader announces nothing for a focused element with no
    // accessible name, so the heading is what actually gives the user
    // something to hear the moment focus moves.
    const heading = await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('renders the honest "could not identify this" state rather than a guess, end to end', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(unidentifiedResult))
    const { user, button } = await uploadAndWaitForButton()
    await user.click(button)

    expect(
      await screen.findByRole('heading', { name: /could not identify this/i }),
    ).toBeInTheDocument()
    // No dish name is rendered as a confirmed result alongside the notice.
    expect(screen.queryByText(identifiedResult.name)).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /photograph of/i })).not.toBeInTheDocument()
  })

  it('shows the server-provided message for a non-2xx response (e.g. a rate limit)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: 'Too many requests. Please wait a moment and try again.' }, false, 429),
    )
    const { user, button } = await uploadAndWaitForButton()
    await user.click(button)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/too many requests/i)
    // A 429 is a usage limit, not a request failure — it must NOT share the
    // "problem on our side... same photo is fine" framing used for a genuine
    // 500, which would be actively misleading (retrying "in a moment" inside
    // a burst window just re-triggers the limit).
    expect(alert).not.toHaveTextContent(/this is a problem on our side/i)
    expect(alert).toHaveTextContent(/usage limit/i)
  })

  it('gives a 429 its own honest treatment, distinct wording from a request failure, with no Retry-After header available', async () => {
    // Retry-After is not on the CORS-safelisted response header list, so a
    // cross-origin deployment with no explicit Access-Control-Expose-Headers
    // will not expose it to fetch — this is the realistic case, and the
    // frontend must still degrade to an honest message rather than crash or
    // fabricate a specific wait time it does not actually know.
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: 'Too many requests. Please wait a moment and try again.' }, false, 429),
    )
    const { user, button } = await uploadAndWaitForButton()
    await user.click(button)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/busy/i)
    expect(alert).not.toHaveTextContent(/something went wrong/i)
  })

  it('distinguishes the per-minute burst limit from the daily limit when Retry-After is readable', async () => {
    const shortWaitResponse = {
      ok: false,
      status: 429,
      headers: { get: (name: string) => (name === 'Retry-After' ? '30' : null) },
      json: async () => ({ error: 'Too many requests. Please wait a moment and try again.' }),
    } as unknown as Response
    vi.mocked(fetch).mockResolvedValue(shortWaitResponse)

    const { user, button } = await uploadAndWaitForButton()
    await user.click(button)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/per minute/i)
    expect(alert).not.toHaveTextContent(/daily/i)
  })

  it('describes the daily limit distinctly when Retry-After indicates a long wait', async () => {
    const longWaitResponse = {
      ok: false,
      status: 429,
      headers: { get: (name: string) => (name === 'Retry-After' ? '43200' : null) }, // 12h
      json: async () => ({ error: 'Too many requests. Please wait a moment and try again.' }),
    } as unknown as Response
    vi.mocked(fetch).mockResolvedValue(longWaitResponse)

    const { user, button } = await uploadAndWaitForButton()
    await user.click(button)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/daily/i)
  })

  it('shows a generic message for a non-2xx response with no parseable error body', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async (): Promise<unknown> => {
        throw new SyntaxError('Unexpected end of input')
      },
    } as unknown as Response)
    const { user, button } = await uploadAndWaitForButton()
    await user.click(button)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/something went wrong while identifying this photo/i)
  })

  it('shows a network-failure message when fetch itself throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    const { user, button } = await uploadAndWaitForButton()
    await user.click(button)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i)
  })

  it('treats a 200 response with a malformed/incomplete body as an error rather than crashing', async () => {
    // Missing every field but `identified` — a contract drift or a corrupted
    // response, not a valid AnalyzeResponse.
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ identified: true }))
    const { user, button } = await uploadAndWaitForButton()
    await user.click(button)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /something went wrong while identifying this photo/i,
    )
  })

  it('clears a previous error when a new photo is chosen', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: 'Failed to analyze image' }, false, 500),
    )
    const { user, button } = await uploadAndWaitForButton()
    await user.click(button)
    await screen.findByRole('alert')

    uploadFile(screen.getByLabelText(/upload a photo/i), jpegFile())

    // The upload goes through FileReader, which resolves asynchronously.
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /identify this food/i })).toBeInTheDocument()
  })

  it('only applies the result of the most recent request when a second photo is analyzed before the first request resolves', async () => {
    // A real fetch rejects with AbortError when its signal is aborted; this
    // mock replicates that so the test exercises App's actual abort-handling
    // branch rather than a stand-in that happens to resolve harmlessly.
    const pending: Array<{ resolve: (r: Response) => void }> = []
    vi.mocked(fetch).mockImplementation((_url, init) => {
      return new Promise<Response>((resolve, reject) => {
        pending.push({ resolve })
        ;(init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    })

    const user = userEvent.setup()
    render(<App />)
    uploadFile(screen.getByLabelText(/upload a photo/i), jpegFile())
    await user.click(await screen.findByRole('button', { name: /identify this food/i }))

    // A second photo, analyzed before the first call resolves. This aborts
    // the first request's controller.
    uploadFile(screen.getByLabelText(/upload a photo/i), jpegFile())
    await user.click(await screen.findByRole('button', { name: /identify this food/i }))

    // Resolve the abandoned first request last, with a *different* result —
    // if abort were not wired up correctly this would win the race.
    pending[1]?.resolve(jsonResponse(identifiedResult))
    pending[0]?.resolve(jsonResponse(unidentifiedResult))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /could not identify this/i }),
    ).not.toBeInTheDocument()
  })
})
