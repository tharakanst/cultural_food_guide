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
  } else if (currentItem && currentState?.status === 'error') {
    announcement = `Could not load details for ${currentItem.name}.`
  }

  const goPrevious = () => {
    setCurrentIndex((index) => Math.max(0, index - 1))
  }

  const goNext = () => {
    setCurrentIndex((index) =>
      Math.min(items.length - 1, index + 1),
    )
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