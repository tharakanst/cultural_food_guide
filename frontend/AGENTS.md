# Frontend — Agent Instructions

Applies to everything under `frontend/`. Root [AGENTS.md](../AGENTS.md) still
applies; this file adds rules specific to the presentation layer.

## Responsibility

React 19 + Vite + TypeScript. Captures or accepts a photo, sends it to our
backend, and presents the result. It holds no secrets and talks to no external
service.

## Hard rules

1. **Never call the AI provider directly.** All AI access goes through our
   backend at `/api/analyze`. Putting the provider SDK or an API key in frontend
   code ships that key to every visitor in the JavaScript bundle.
2. **Never use `dangerouslySetInnerHTML`.** Everything rendered from the API
   originates in model output, which originates in a photograph of arbitrary
   text. React's default escaping is the protection; do not bypass it.
3. **Allergen and dietary information is safety-critical.** It gets full contrast,
   normal text size, and a clear heading. It is never the smallest, faintest
   thing on the screen.

## Users and context

Exchange students and visitors reading in a second language, usually on a phone,
often standing in a shop or restaurant. Assume hurried reading and low language
confidence. Content that is technically present but hard to parse has failed.

## Accessibility requirements

These come from the project plan and are not optional:

- Every image has meaningful alt text. Describe the dish, not the file.
- Loading, error, and result states are announced to screen readers via
  `aria-live` — not only rendered visually.
- Every control is reachable and operable by keyboard. Be careful with the file
  upload control: a visually hidden input inside a label commonly loses keyboard
  focus.
- All colour pairs meet WCAG AA — 4.5:1 for body text, 3:1 for large text.
- Text-to-speech for recipe steps uses the browser `SpeechSynthesis` API.

## Styling

Plain CSS with custom properties. All colours are defined as variables in one
place so contrast can be audited centrally — do not introduce hardcoded colour
values in component styles.

Responsive and mobile-first. The app is a PWA and must work installed on a phone
as well as in a desktop browser.

## Camera

`getUserMedia` with `facingMode: 'environment'` so phones open the rear camera.
Always keep the file-upload path working as a fallback — camera permission is
frequently denied, and the app must remain usable when it is.

Note for local testing on a real phone: `getUserMedia` requires HTTPS on anything
that is not `localhost`.

## Testing

Vitest plus React Testing Library. Query by accessible role and label rather than
test IDs — tests that find elements the way a screen reader does catch
accessibility regressions for free.
