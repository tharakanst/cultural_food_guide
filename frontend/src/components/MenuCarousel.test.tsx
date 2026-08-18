/**
 * Tests for MenuCarousel — the per-item viewer shown when a photographed
 * menu contains several orderable dishes.
 *
 * MenuCarousel never calls fetch itself; it receives a `loadItem` prop and
 * treats whatever it resolves or rejects with as the whole contract. That
 * makes it possible to test every loading/error/cache path here without any
 * network mocking, while App.test.tsx separately covers the real fetch-based
 * `loadItem` implementation wired up in App.tsx (request shape, and how a
 * non-2xx response versus a network failure are turned into an Error).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MenuCarousel } from './MenuCarousel'
import type { AnalyzeResponse, MenuItemSource } from '../../../shared/types'

const ITEMS: MenuItemSource[] = [
  { name: 'Karjalanpiirakka', menuText: 'Rye pastry with rice porridge filling.' },
  { name: 'Lohikeitto', menuText: 'Creamy salmon soup with potato and leek.' },
  { name: 'Korvapuusti', menuText: 'Cinnamon and cardamom bun.' },
]

const DISCLAIMER = 'This information is AI-generated and may be wrong.'

function buildResult(name: string): AnalyzeResponse {
  return {
    resultType: 'food',
    menuItems: [],
    identified: true,
    name,
    description: `${name} is a traditional dish.`,
    ingredients: ['flour', 'salt'],
    allergens: ['Likely contains gluten — typical for this dish'],
    culturalContext: `${name} is commonly found in Finland.`,
    disclaimer: DISCLAIMER,
  }
}

/**
 * A `loadItem` mock whose promise, per item name, is resolved or rejected
 * only when the test tells it to. MenuCarousel deliberately preloads the
 * item ahead of the one being viewed once the current one is ready (see the
 * component's own comment on that effect) — a single shared promise would
 * make that preload resolve every pending call at once and hide bugs in the
 * per-item state.
 */
function controllableLoadItem() {
  const pending = new Map<
    string,
    { resolve: (value: AnalyzeResponse) => void; reject: (reason: unknown) => void }
  >()
  const calls: string[] = []

  const loadItem = vi.fn((item: MenuItemSource) => {
    calls.push(item.name)
    return new Promise<AnalyzeResponse>((resolve, reject) => {
      pending.set(item.name, { resolve, reject })
    })
  })

  return {
    loadItem,
    calls,
    resolve(name: string, result: AnalyzeResponse) {
      pending.get(name)?.resolve(result)
    },
    reject(name: string, error: unknown) {
      pending.get(name)?.reject(error)
    },
  }
}

describe('MenuCarousel — no menu items extracted', () => {
  it('shows an honest "could not read this menu" panel and never calls loadItem', () => {
    const loadItem = vi.fn()
    render(<MenuCarousel items={[]} disclaimer={DISCLAIMER} loadItem={loadItem} />)

    expect(
      screen.getByRole('heading', { name: /we could not read this menu/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument()
    expect(loadItem).not.toHaveBeenCalled()
  })
})

describe('MenuCarousel — rendering the menu list', () => {
  it('renders the heading, item count and navigation controls for a multi-item menu', () => {
    const { loadItem } = controllableLoadItem()
    render(<MenuCarousel items={ITEMS} disclaimer={DISCLAIMER} loadItem={loadItem} />)

    expect(screen.getByRole('heading', { name: /menu found/i })).toBeInTheDocument()
    expect(screen.getByText('3 items detected.')).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^next$/i })).toBeEnabled()
  })

  it('uses singular wording and disables both nav buttons for a single-item menu', () => {
    const { loadItem } = controllableLoadItem()
    render(<MenuCarousel items={[ITEMS[0]!]} disclaimer={DISCLAIMER} loadItem={loadItem} />)

    expect(screen.getByText('1 item detected.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()
  })

  it('requests the first item automatically on mount, and only that one', () => {
    const { loadItem, calls } = controllableLoadItem()
    render(<MenuCarousel items={ITEMS} disclaimer={DISCLAIMER} loadItem={loadItem} />)
    expect(calls).toEqual(['Karjalanpiirakka'])
  })
})

describe('MenuCarousel — per-item loading state', () => {
  it('shows a loading indicator for the item in flight and announces it via the live region', async () => {
    const { loadItem } = controllableLoadItem()
    render(<MenuCarousel items={ITEMS} disclaimer={DISCLAIMER} loadItem={loadItem} />)

    expect(screen.getByText(/loading details…/i)).toBeInTheDocument()
    // The loading panel is aria-hidden (the live region below is the
    // authoritative announcement for assistive tech), so its heading is
    // queried by text rather than by role — a role query would correctly
    // not find it, since it is intentionally excluded from the a11y tree.
    expect(screen.getByText('Karjalanpiirakka').tagName).toBe('H3')

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        /loading details for karjalanpiirakka/i,
      ),
    )
  })

  it('replaces the loading state with the result once loadItem resolves, and updates the live region', async () => {
    const { loadItem, resolve } = controllableLoadItem()
    render(<MenuCarousel items={ITEMS} disclaimer={DISCLAIMER} loadItem={loadItem} />)

    resolve('Karjalanpiirakka', buildResult('Karjalanpiirakka'))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/loading details…/i)).not.toBeInTheDocument()

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        /details ready for karjalanpiirakka\. item 1 of 3\./i,
      ),
    )
  })

  it('renders the resolved result through FoodResult, including allergens', async () => {
    const { loadItem, resolve } = controllableLoadItem()
    render(<MenuCarousel items={ITEMS} disclaimer={DISCLAIMER} loadItem={loadItem} />)
    resolve('Karjalanpiirakka', buildResult('Karjalanpiirakka'))

    await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' })
    expect(
      screen.getByRole('heading', { name: /allergens and dietary information/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/likely contains gluten/i)).toBeInTheDocument()
  })
})

describe('MenuCarousel — selecting an item / keyboard navigation', () => {
  it('requests the next item when "Next" is clicked and updates the counter', async () => {
    const { loadItem, resolve, calls } = controllableLoadItem()
    const user = userEvent.setup()
    render(<MenuCarousel items={ITEMS} disclaimer={DISCLAIMER} loadItem={loadItem} />)
    resolve('Karjalanpiirakka', buildResult('Karjalanpiirakka'))
    await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' })

    await user.click(screen.getByRole('button', { name: /^next$/i }))

    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(calls).toContain('Lohikeitto')
    expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled()
  })

  it('is operable by keyboard: Tab reaches "Next" (Previous is disabled and skipped) and Enter activates it', async () => {
    const { loadItem, resolve } = controllableLoadItem()
    const user = userEvent.setup()
    render(<MenuCarousel items={ITEMS} disclaimer={DISCLAIMER} loadItem={loadItem} />)
    resolve('Karjalanpiirakka', buildResult('Karjalanpiirakka'))
    await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' })

    await user.tab()
    expect(screen.getByRole('button', { name: /^next$/i })).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(screen.getByText('2 / 3')).toBeInTheDocument()
  })

  it('goes back to a previously viewed item using its cached result, without calling loadItem again', async () => {
    const { loadItem, resolve, calls } = controllableLoadItem()
    const user = userEvent.setup()
    render(<MenuCarousel items={ITEMS} disclaimer={DISCLAIMER} loadItem={loadItem} />)

    resolve('Karjalanpiirakka', buildResult('Karjalanpiirakka'))
    await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' })

    await user.click(screen.getByRole('button', { name: /^next$/i }))
    resolve('Lohikeitto', buildResult('Lohikeitto'))
    await screen.findByRole('heading', { level: 2, name: 'Lohikeitto' })

    calls.length = 0
    await user.click(screen.getByRole('button', { name: /previous/i }))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' }),
    ).toBeInTheDocument()
    expect(calls).not.toContain('Karjalanpiirakka')
  })

  it('disables "Next" on the last item and re-enables "Previous" once past the first', async () => {
    const { loadItem, resolve } = controllableLoadItem()
    const user = userEvent.setup()
    render(<MenuCarousel items={ITEMS} disclaimer={DISCLAIMER} loadItem={loadItem} />)
    resolve('Karjalanpiirakka', buildResult('Karjalanpiirakka'))
    await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' })

    await user.click(screen.getByRole('button', { name: /^next$/i }))
    resolve('Lohikeitto', buildResult('Lohikeitto'))
    await screen.findByRole('heading', { level: 2, name: 'Lohikeitto' })
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    resolve('Korvapuusti', buildResult('Korvapuusti'))
    await screen.findByRole('heading', { level: 2, name: 'Korvapuusti' })

    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled()
  })

  it('moves focus to "Next" when a click is about to disable "Previous", instead of losing focus to <body>', async () => {
    // Browsers unconditionally blur a button the instant it becomes
    // disabled. Without an explicit focus target, a keyboard user who just
    // pressed "Previous" back to the first item would silently lose focus.
    const { loadItem, resolve } = controllableLoadItem()
    const user = userEvent.setup()
    render(<MenuCarousel items={ITEMS} disclaimer={DISCLAIMER} loadItem={loadItem} />)
    resolve('Karjalanpiirakka', buildResult('Karjalanpiirakka'))
    await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' })

    await user.click(screen.getByRole('button', { name: /^next$/i }))
    resolve('Lohikeitto', buildResult('Lohikeitto'))
    await screen.findByRole('heading', { level: 2, name: 'Lohikeitto' })

    const previousButton = screen.getByRole('button', { name: /previous/i })
    previousButton.focus()
    expect(previousButton).toHaveFocus()

    await user.click(previousButton)

    expect(previousButton).toBeDisabled()
    expect(screen.getByRole('button', { name: /^next$/i })).toHaveFocus()
  })

  it('moves focus to "Previous" for a two-item menu too, where Previous starts disabled', async () => {
    // Regression test for a real bug: the original fix called .focus()
    // synchronously inside goNext, before setCurrentIndex's update had
    // actually committed to the DOM. For a two-item menu — the only case
    // where the first item is also the second-to-last — Previous is still
    // disabled at that exact instant, and focusing a disabled element is a
    // no-op. The fix defers the focus call to an effect keyed on
    // currentIndex, which only runs after the render (and Previous becoming
    // enabled) has actually committed. See pendingBoundaryFocusRef in
    // MenuCarousel.tsx.
    const { loadItem, resolve } = controllableLoadItem()
    const user = userEvent.setup()
    render(
      <MenuCarousel items={[ITEMS[0]!, ITEMS[1]!]} disclaimer={DISCLAIMER} loadItem={loadItem} />,
    )
    resolve('Karjalanpiirakka', buildResult('Karjalanpiirakka'))
    await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' })

    const nextButton = screen.getByRole('button', { name: /^next$/i })
    nextButton.focus()
    expect(nextButton).toHaveFocus()

    await user.click(nextButton)
    resolve('Lohikeitto', buildResult('Lohikeitto'))
    await screen.findByRole('heading', { level: 2, name: 'Lohikeitto' })

    expect(nextButton).toBeDisabled()
    expect(screen.getByRole('button', { name: /previous/i })).toHaveFocus()
  })
})

describe('MenuCarousel — per-item request failure', () => {
  it('shows the server-provided error message for a non-2xx response, in an alert region', async () => {
    const loadItem = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not load details for this menu item.'))
    render(<MenuCarousel items={[ITEMS[0]!]} disclaimer={DISCLAIMER} loadItem={loadItem} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load details for this menu item/i)
    expect(within(alert).getByRole('heading', { name: 'Karjalanpiirakka' })).toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(within(alert).getByText(DISCLAIMER)).toBeInTheDocument()
  })

  it('falls back to the generic message for a network-style failure with no usable message', async () => {
    // Mirrors a rejection whose Error carries no message at all.
    const loadItem = vi.fn().mockRejectedValueOnce(new Error(''))
    render(<MenuCarousel items={[ITEMS[0]!]} disclaimer={DISCLAIMER} loadItem={loadItem} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      /could not load details for this menu item\. please try again\./i,
    )
  })

  it('falls back to the generic message when the rejection is not an Error at all', async () => {
    const loadItem = vi.fn().mockRejectedValueOnce('network down')
    render(<MenuCarousel items={[ITEMS[0]!]} disclaimer={DISCLAIMER} loadItem={loadItem} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      /could not load details for this menu item\. please try again\./i,
    )
  })

  it('does not repeat the error in the polite live region — the role="alert" panel already announces it, matching App.tsx\'s own error-state convention', async () => {
    const loadItem = vi.fn().mockRejectedValueOnce(new Error('Server error'))
    render(<MenuCarousel items={[ITEMS[0]!]} disclaimer={DISCLAIMER} loadItem={loadItem} />)

    await screen.findByRole('alert')
    // role="alert" is itself an assertive live region, announced the moment
    // it mounts; the separate role="status" region staying silent here is
    // intentional, not a missed update — see the comment above the
    // `announcement` calculation in MenuCarousel.tsx.
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('retries the same item when "Try again" is pressed, and recovers on success', async () => {
    const loadItem = vi
      .fn()
      .mockRejectedValueOnce(new Error('Temporary failure.'))
      .mockResolvedValueOnce(buildResult('Karjalanpiirakka'))
    const user = userEvent.setup()
    render(<MenuCarousel items={[ITEMS[0]!]} disclaimer={DISCLAIMER} loadItem={loadItem} />)

    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' }),
    ).toBeInTheDocument()
    expect(loadItem).toHaveBeenCalledTimes(2)
  })

  it('does not update state (or crash) if the component unmounts while a request is still pending', async () => {
    const { loadItem, reject } = controllableLoadItem()
    const { unmount } = render(
      <MenuCarousel items={[ITEMS[0]!]} disclaimer={DISCLAIMER} loadItem={loadItem} />,
    )

    unmount()
    // The mountedRef guard exists precisely so that a late rejection (e.g.
    // the user takes another photo while a menu item is still loading) does
    // not throw or warn about updating an unmounted component.
    expect(() => reject('Karjalanpiirakka', new Error('too late'))).not.toThrow()
  })
})

describe('MenuCarousel — a new menu replaces the previous one', () => {
  it('resets to the first item and does not reuse the previous menu\'s cache or in-flight state', async () => {
    const first = controllableLoadItem()
    const { rerender } = render(
      <MenuCarousel items={ITEMS} disclaimer={DISCLAIMER} loadItem={first.loadItem} />,
    )
    first.resolve('Karjalanpiirakka', buildResult('Karjalanpiirakka'))
    await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    first.resolve('Lohikeitto', buildResult('Lohikeitto'))
    await screen.findByRole('heading', { level: 2, name: 'Lohikeitto' })

    const newItems: MenuItemSource[] = [{ name: 'Munkki', menuText: 'A Finnish doughnut.' }]
    const second = controllableLoadItem()
    rerender(<MenuCarousel items={newItems} disclaimer={DISCLAIMER} loadItem={second.loadItem} />)

    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    expect(second.calls).toEqual(['Munkki'])
  })
})

describe('MenuCarousel — quiet preloading', () => {
  it('preloads exactly the next item once the current one is ready, without prefetching further ahead', async () => {
    const { loadItem, resolve, calls } = controllableLoadItem()
    render(<MenuCarousel items={ITEMS} disclaimer={DISCLAIMER} loadItem={loadItem} />)

    expect(calls).toEqual(['Karjalanpiirakka'])
    resolve('Karjalanpiirakka', buildResult('Karjalanpiirakka'))
    await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' })

    await waitFor(() => expect(calls).toEqual(['Karjalanpiirakka', 'Lohikeitto']))
    // The third item is never requested until the user actually looks at it.
    expect(calls).not.toContain('Korvapuusti')
  })

  it('does not preload past the last item', async () => {
    const { loadItem, resolve, calls } = controllableLoadItem()
    render(<MenuCarousel items={[ITEMS[0]!]} disclaimer={DISCLAIMER} loadItem={loadItem} />)

    resolve('Karjalanpiirakka', buildResult('Karjalanpiirakka'))
    await screen.findByRole('heading', { level: 2, name: 'Karjalanpiirakka' })

    // Give any stray preload effect a turn to run, then confirm nothing else
    // was requested for a single-item menu.
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toEqual(['Karjalanpiirakka'])
  })
})
