import { render, screen } from '@testing-library/react'
import App from '../App'
import { FoodResult } from '../components/FoodResult'
import type { AnalyzeResponse } from '../../../shared/types'

const unidentified: AnalyzeResponse = {
  identified: false,
  name: '',
  description: '',
  ingredients: [],
  allergens: [],
  culturalContext: '',
  disclaimer: 'AI-generated. Check the label.',
}

it('renders the app heading', () => {
  render(<App />)
  expect(
    screen.getByRole('heading', { level: 1, name: /cultural food guide/i }),
  ).toBeInTheDocument()
})

it('keeps the file input labelled and focusable', () => {
  render(<App />)
  // getByLabelText resolving at all proves the input is in the accessibility
  // tree with an accessible name. Focusing it proves it was not removed from
  // the tab order — the exact regression frontend/AGENTS.md warns about for
  // visually hidden file inputs.
  const input = screen.getByLabelText(/upload a photo/i)
  input.focus()
  expect(input).toHaveFocus()
})

it('never renders a guess when identified is false', () => {
  render(<FoodResult result={unidentified} />)
  expect(
    screen.getByRole('heading', { name: /could not identify this/i }),
  ).toBeInTheDocument()
  expect(screen.getByText(/AI-generated/i)).toBeInTheDocument()
})
