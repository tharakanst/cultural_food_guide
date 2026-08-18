import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnalyzeResponse, MenuItemSource } from '../../../shared/types'
import { FoodResult } from './FoodResult'

interface MenuCarouselProps {
  items: MenuItemSource[]
  disclaimer: string
  loadItem: (item: MenuItemSource) => Promise<AnalyzeResponse>
}

type ItemLoadState =
  | { status: 'loading' }
  | { status: 'ready'; result: AnalyzeResponse }
  | { status: 'error'; message: string }

const ITEM_LOAD_ERROR =
  'Could not load details for this menu item. Please try again.'

export function MenuCarousel({
  items,
  disclaimer,
  loadItem,
}: MenuCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [itemStates, setItemStates] = useState<
    Record<number, ItemLoadState>
  >({})

  /*
   * Previous/Next become disabled exactly when the click that just fired
   * lands on a boundary. Browsers unconditionally blur a button the instant
   * it is disabled, which drops keyboard focus to <body> with no warning —
   * the same class of bug CameraCapture guards against for its own
   * status-dependent controls. These refs let goPrevious/goNext move focus
   * to the button that stays enabled instead of losing it.
   */
  const previousButtonRef = useRef<HTMLButtonElement | null>(null)
  const nextButtonRef = useRef<HTMLButtonElement | null>(null)

  /*
   * Which boundary button should take focus once the render this click
   * triggers has actually committed.
   *
   * Calling .focus() synchronously inside goPrevious/goNext looked right but
   * was not: at that point in the event handler, setCurrentIndex has only
   * been queued, not yet applied to the DOM, so the target button can still
   * be showing its *previous* disabled state. For most transitions the
   * target was already enabled before the click, so this was invisible, but
   * a two-item menu can move from index 0 straight to the last index in one
   * click, and Previous is disabled at index 0 — a disabled element cannot
   * take focus, so the call silently did nothing. Deferring the focus call
   * to an effect keyed on currentIndex guarantees it runs after commit, once
   * the target is actually enabled — the same pattern CameraCapture already
   * uses for its own status-dependent controls.
   */
  const pendingBoundaryFocusRef = useRef<'previous' | 'next' | null>(null)

  useEffect(() => {
    if (pendingBoundaryFocusRef.current === 'previous') {
      previousButtonRef.current?.focus()
    } else if (pendingBoundaryFocusRef.current === 'next') {
      nextButtonRef.current?.focus()
    }
    pendingBoundaryFocusRef.current = null
  }, [currentIndex])

  /*
   * Results that have already been generated stay cached for the lifetime of
   * this menu result. Returning to an earlier item therefore does not make
   * another OpenAI request.
   */
  const cacheRef = useRef(new Map<number, AnalyzeResponse>())

  /*
   * Prevent the same item from being requested twice if React re-renders while
   * its request is still in progress.
   */
  const inFlightRef = useRef(new Set<number>())

  /*
   * Do not update state if the user takes another photo and this carousel
   * disappears while a menu-item request is still finishing.
   */
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  /*
   * If a completely different menu is supplied, discard the previous menu's
   * navigation position and cached analyses.
   */
  useEffect(() => {
    setCurrentIndex(0)
    setItemStates({})
    cacheRef.current.clear()
    inFlightRef.current.clear()
  }, [items])

  const ensureLoaded = useCallback(
    async (index: number, force = false) => {
      const item = items[index]
      if (!item) return

      if (!force) {
        const cached = cacheRef.current.get(index)

        if (cached) {
          setItemStates((current) => ({
            ...current,
            [index]: {
              status: 'ready',
              result: cached,
            },
          }))
          return
        }

        if (inFlightRef.current.has(index)) {
          return
        }
      }

      inFlightRef.current.add(index)

      setItemStates((current) => ({
        ...current,
        [index]: { status: 'loading' },
      }))

      try {
        const result = await loadItem(item)

        if (!mountedRef.current) return

        cacheRef.current.set(index, result)

        setItemStates((current) => ({
          ...current,
          [index]: {
            status: 'ready',
            result,
          },
        }))
      } catch (error) {
        if (!mountedRef.current) return

        setItemStates((current) => ({
          ...current,
          [index]: {
            status: 'error',
            message:
              error instanceof Error && error.message
                ? error.message
                : ITEM_LOAD_ERROR,
          },
        }))
      } finally {
        inFlightRef.current.delete(index)
      }
    },
    [items, loadItem],
  )

  /*
   * Only analyse the item the user is currently viewing.
   *
   * There is deliberately no prefetching here: if the user looks at only
   * three items from a ten-item menu, only those three detailed analyses are
   * generated.
   */
  useEffect(() => {
    void ensureLoaded(currentIndex)
  }, [currentIndex, ensureLoaded])

  /*
  * Once the current item is ready, quietly preload exactly one item ahead.
  *
  * This improves carousel responsiveness without generating the entire menu.
  * At most one unseen item's analysis is generated ahead of the user.
  */
  useEffect(() => {
    if (itemStates[currentIndex]?.status !== 'ready') {
      return
    }

    const nextIndex = currentIndex + 1

    if (nextIndex >= items.length) {
      return
    }

    if (
      cacheRef.current.has(nextIndex) ||
      inFlightRef.current.has(nextIndex)
    ) {
      return
    }

    void ensureLoaded(nextIndex)
  }, [
    currentIndex,
    itemStates,
    items.length,
    ensureLoaded,
  ])

  if (items.length === 0) {
    return (
      <div className="result">
        <div className="panel panel--notice">
          <h2 tabIndex={-1}>
            <span aria-hidden="true">ℹ️ </span>
            We could not read this menu
          </h2>
          <p>
            No menu items could be extracted reliably. Try taking a closer,
            straighter photo of the menu.
          </p>
        </div>

        <p className="disclaimer">
          <span aria-hidden="true">ℹ️ </span>
          {disclaimer}
        </p>
      </div>
    )
  }

  const currentItem = items[currentIndex]
  const currentState = itemStates[currentIndex]

  let announcement = ''

  if (currentItem && currentState?.status === 'loading') {
    announcement = `Loading details for ${currentItem.name}.`
  } else if (currentItem && currentState?.status === 'ready') {
    announcement =
      `Details ready for ${currentItem.name}. ` +
      `Item ${currentIndex + 1} of ${items.length}.`
  }
  // Deliberately no case for status 'error': the role="alert" panel below
  // already announces it on mount. Announcing it here too would say the same
  // thing twice, which the project treats as worse than saying it once — see
  // App.tsx's identical reasoning for its own error state.

  const goPrevious = () => {
    const newIndex = Math.max(0, currentIndex - 1)
    if (newIndex === 0) {
      // This click is about to disable Previous. Flag Next to take focus
      // once the render actually commits — see pendingBoundaryFocusRef above
      // for why this cannot be done synchronously here.
      pendingBoundaryFocusRef.current = 'next'
    }
    setCurrentIndex(newIndex)
  }

  const goNext = () => {
    const newIndex = Math.min(items.length - 1, currentIndex + 1)
    if (newIndex === items.length - 1) {
      pendingBoundaryFocusRef.current = 'previous'
    }
    setCurrentIndex(newIndex)
  }

  return (
    <section
      className="menu-carousel"
      aria-labelledby="menu-carousel-heading"
    >
      <div className="menu-carousel__header">
        <h2 id="menu-carousel-heading" tabIndex={-1}>
          Menu found
        </h2>

        <p>
          {items.length} {items.length === 1 ? 'item' : 'items'} detected.
        </p>
      </div>

      {/*
       * Keep this live region permanently mounted. Only its text changes,
       * matching the accessibility pattern already used elsewhere in the app.
       */}
      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
      >
        {announcement}
      </p>

      <nav
        className="menu-carousel__nav"
        aria-label="Menu item navigation"
      >
        <button
          ref={previousButtonRef}
          type="button"
          className="btn"
          onClick={goPrevious}
          disabled={currentIndex === 0}
        >
          Previous
        </button>

        <span className="menu-carousel__counter">
          {currentIndex + 1} / {items.length}
        </span>

        <button
          ref={nextButtonRef}
          type="button"
          className="btn"
          onClick={goNext}
          disabled={currentIndex === items.length - 1}
        >
          Next
        </button>
      </nav>

      <div className="menu-carousel__slide">
        {currentState?.status === 'ready' ? (
          /*
           * This is deliberately the existing FoodResult component.
           *
           * It preserves the exact single-food layout, including Wikimedia,
           * allergens, ingredients, recipe, cultural context, disclaimer and
           * the existing recipe text-to-speech behaviour.
           */
          <FoodResult result={currentState.result} />
        ) : currentState?.status === 'error' ? (
          <div className="panel panel--error" role="alert">
            <h3>{currentItem?.name ?? 'Menu item'}</h3>

            <p>{currentState.message}</p>

            <div className="actions">
              <button
                type="button"
                className="btn"
                onClick={() => void ensureLoaded(currentIndex, true)}
              >
                Try again
              </button>
            </div>

            <p className="disclaimer">
              <span aria-hidden="true">ℹ️ </span>
              {disclaimer}
            </p>
          </div>
        ) : (
          <div
            className="panel menu-carousel__loading"
            aria-hidden="true"
          >
            <h3>{currentItem?.name ?? 'Menu item'}</h3>

            <div className="status">
              <span className="spinner" />
              <span>Loading details…</span>
            </div>

            <p className="disclaimer">
              <span aria-hidden="true">ℹ️ </span>
              {disclaimer}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

export default MenuCarousel