/**
 * Vitest setup — runs before every test file.
 *
 * Registers @testing-library/jest-dom's matchers (toBeInTheDocument,
 * toHaveAccessibleName, and the rest) on Vitest's expect, and clears the DOM
 * between tests so a leaked live region cannot make the next test pass.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
