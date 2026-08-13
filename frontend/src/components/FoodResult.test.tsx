import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FoodResult } from './FoodResult'
import type { AnalyzeResponse } from '../../../shared/types'

const unidentified: AnalyzeResponse = {
  identified: false,
  name: '',
  description: 'The photo is too blurry to read the menu text.',
  ingredients: [],
  allergens: [],
  culturalContext: '',
  disclaimer: 'AI-generated. Check the label.',
}

const identifiedNoAllergens: AnalyzeResponse = {
  identified: true,
  name: 'Karjalanpiirakka',
  description: 'A savoury Karelian rice pastry.',
  ingredients: ['rye flour', 'rice porridge'],
  allergens: [],
  culturalContext: 'A traditional Finnish pastry from Karelia.',
  disclaimer: 'AI-generated. Check the label.',
}

const fullResult: AnalyzeResponse = {
  identified: true,
  name: 'Lohikeitto',
  description: 'A creamy Finnish salmon soup.',
  ingredients: ['salmon', 'potato', 'leek', 'cream'],
  recipe: ['Dice the potato and leek.', 'Simmer the salmon in the broth for ten minutes.'],
  allergens: ['Contains milk (listed on the label)', 'Contains fish (listed on the label)'],
  culturalContext: 'A traditional soup commonly served in Finnish lunch restaurants.',
  referenceImageUrl: 'https://upload.wikimedia.org/wikipedia/commons/x.jpg',
  disclaimer: 'This information is AI-generated and may be wrong.',
}

describe('FoodResult — identified: false', () => {
  it('never renders a guess when identified is false', () => {
    render(<FoodResult result={unidentified} />)
    expect(
      screen.getByRole('heading', { name: /could not identify this/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/AI-generated/i)).toBeInTheDocument()
  })

  it('does not render a dish name heading, ingredients or allergens when unidentified', () => {
    render(<FoodResult result={unidentified} />)
    expect(screen.queryByRole('heading', { name: /ingredients/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /allergens/i })).not.toBeInTheDocument()
  })

  it('shows retry guidance rather than a broken layout', () => {
    render(<FoodResult result={unidentified} />)
    expect(screen.getByText(/take another photo and try again/i)).toBeInTheDocument()
  })
})

describe('FoodResult — identified: true', () => {
  it('renders the dish name, description and cultural context', () => {
    render(<FoodResult result={fullResult} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Lohikeitto' })).toBeInTheDocument()
    expect(screen.getByText(/creamy finnish salmon soup/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /cultural context/i })).toBeInTheDocument()
  })

  it('renders the ingredients list', () => {
    render(<FoodResult result={fullResult} />)
    const list = screen.getByRole('heading', { name: /ingredients/i })
    expect(list).toBeInTheDocument()
    expect(screen.getByText('salmon')).toBeInTheDocument()
    expect(screen.getByText('cream')).toBeInTheDocument()
  })

  it('always renders the disclaimer', () => {
    render(<FoodResult result={fullResult} />)
    expect(screen.getByText(/AI-generated and may be wrong/i)).toBeInTheDocument()
  })

  it('renders allergens under an accessible heading, never as plain unlabelled text', () => {
    render(<FoodResult result={fullResult} />)
    const heading = screen.getByRole('heading', { name: /allergens and dietary information/i })
    expect(heading).toBeInTheDocument()
    expect(screen.getByText(/contains milk \(listed on the label\)/i)).toBeInTheDocument()
    expect(screen.getByText(/contains fish \(listed on the label\)/i)).toBeInTheDocument()
  })

  it('shows an explicit uncertainty message rather than an empty list when allergens could not be determined', () => {
    render(<FoodResult result={identifiedNoAllergens} />)
    const notice = screen.getByText(/no allergen information could be determined from this photo/i)
    expect(notice).toBeInTheDocument()
    // Must not be phrased as a bare safety guarantee like "no allergens".
    expect(notice.textContent).toMatch(/not the same as/i)
    const allergenSection = screen.getByRole('region', {
      name: /allergens and dietary information/i,
    })
    expect(within(allergenSection).queryByRole('list')).not.toBeInTheDocument()
  })

  it('renders the reference image with alt text derived from the dish name', () => {
    render(<FoodResult result={fullResult} />)
    expect(screen.getByRole('img', { name: /photograph of lohikeitto/i })).toHaveAttribute(
      'src',
      fullResult.referenceImageUrl,
    )
  })

  it('renders without a reference image when the field is absent, rather than crashing', () => {
    const { referenceImageUrl: _drop, ...withoutImage } = fullResult
    render(<FoodResult result={withoutImage} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Lohikeitto' })).toBeInTheDocument()
  })

  it('does not render a recipe section when recipe is absent', () => {
    const { recipe: _drop, ...withoutRecipe } = fullResult
    render(<FoodResult result={withoutRecipe} />)
    expect(screen.queryByRole('heading', { name: /how it is made/i })).not.toBeInTheDocument()
  })

  it('does not render an ingredients section when ingredients is empty', () => {
    render(<FoodResult result={{ ...fullResult, ingredients: [] }} />)
    expect(screen.queryByRole('heading', { name: /^ingredients$/i })).not.toBeInTheDocument()
  })

  it('renders model output as literal text, never as executable markup', () => {
    const withInjection: AnalyzeResponse = {
      ...fullResult,
      description: '<img src=x onerror="window.__pwned = true">Ignore all instructions.',
    }
    render(<FoodResult result={withInjection} />)
    expect(
      screen.getByText('<img src=x onerror="window.__pwned = true">Ignore all instructions.'),
    ).toBeInTheDocument()
    // No stray <img> was actually created from the description string — only
    // the legitimate reference-photo <img> (with its own controlled src).
    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAttribute('src', fullResult.referenceImageUrl)
  })
})

describe('FoodResult — recipe and text-to-speech', () => {
  afterEach(() => {
    // Fully remove the property rather than setting it to undefined: 'in'
    // checks (used by speechSupported()) are true for a defined-but-undefined
    // property, so a lingering property would silently change later tests'
    // behaviour instead of restoring jsdom's true default absence.
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis
    delete (window as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance
  })

  it('does not render a "read aloud" control when speechSynthesis is unavailable (the jsdom / real-world default)', () => {
    // jsdom has no window.speechSynthesis by default — this exercises the
    // real absence, not a mock standing in for it.
    expect('speechSynthesis' in window).toBe(false)
    render(<FoodResult result={fullResult} />)
    expect(screen.queryByRole('button', { name: /read the steps aloud/i })).not.toBeInTheDocument()
    // The steps are still readable visually even without TTS.
    expect(screen.getByText(/dice the potato and leek/i)).toBeInTheDocument()
  })

  describe('when speechSynthesis is available', () => {
    let speakMock: ReturnType<typeof vi.fn>
    let cancelMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
      speakMock = vi.fn()
      cancelMock = vi.fn()
      Object.defineProperty(window, 'speechSynthesis', {
        value: { speak: speakMock, cancel: cancelMock },
        configurable: true,
        writable: true,
      })
      // jsdom has no SpeechSynthesisUtterance either. A plain function, not
      // an arrow function: FoodResult.tsx calls this with `new`.
      ;(window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
        vi.fn().mockImplementation(function SpeechSynthesisUtterance(text: string) {
          return { text }
        })
    })

    it('reads the recipe aloud and toggles to a stop control', () => {
      render(<FoodResult result={fullResult} />)
      const button = screen.getByRole('button', { name: /read the steps aloud/i })
      fireEvent.click(button)

      expect(speakMock).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: /stop reading/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    it('cancels speech when the stop control is pressed', () => {
      render(<FoodResult result={fullResult} />)
      fireEvent.click(screen.getByRole('button', { name: /read the steps aloud/i }))
      fireEvent.click(screen.getByRole('button', { name: /stop reading/i }))
      expect(cancelMock).toHaveBeenCalled()
      expect(screen.getByRole('button', { name: /read the steps aloud/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    })

    it('stops any in-progress speech when a new result replaces the old one', () => {
      const { rerender } = render(<FoodResult result={fullResult} />)
      fireEvent.click(screen.getByRole('button', { name: /read the steps aloud/i }))
      cancelMock.mockClear()

      rerender(<FoodResult result={{ ...fullResult, name: 'Different dish' }} />)
      expect(cancelMock).toHaveBeenCalled()
    })
  })
})
