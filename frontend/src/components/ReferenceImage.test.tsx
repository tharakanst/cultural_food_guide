import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReferenceImage } from './ReferenceImage'

describe('ReferenceImage', () => {
  it('renders nothing when no url is provided', () => {
    const { container } = render(<ReferenceImage url={undefined} alt="A bowl of soup." />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the image with the given accessible alt text and caption', () => {
    render(
      <ReferenceImage
        url="https://upload.wikimedia.org/wikipedia/commons/x.jpg"
        alt="A bowl of creamy salmon soup with dill and potato."
        caption="Reference photograph from Wikimedia Commons."
      />,
    )
    const image = screen.getByRole('img', { name: /a bowl of creamy salmon soup/i })
    expect(image).toHaveAttribute('src', 'https://upload.wikimedia.org/wikipedia/commons/x.jpg')
    expect(screen.getByText(/reference photograph from wikimedia commons/i)).toBeInTheDocument()
  })

  it('omits the caption element when none is provided', () => {
    render(<ReferenceImage url="https://upload.wikimedia.org/x.jpg" alt="A dish." />)
    expect(screen.queryByText(/reference photograph/i)).not.toBeInTheDocument()
  })

  it('hides the image after it fails to load (dead link) instead of showing a broken icon', () => {
    render(<ReferenceImage url="https://upload.wikimedia.org/dead-link.jpg" alt="A dish." />)
    const image = screen.getByRole('img', { name: /a dish/i })
    fireEvent.error(image)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('gives a new url a fresh chance after a previous url failed to load', () => {
    const { rerender } = render(
      <ReferenceImage url="https://upload.wikimedia.org/dead-link.jpg" alt="A dish." />,
    )
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    rerender(<ReferenceImage url="https://upload.wikimedia.org/working-link.jpg" alt="A dish." />)
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'https://upload.wikimedia.org/working-link.jpg',
    )
  })
})
