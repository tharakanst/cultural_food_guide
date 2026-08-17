# Accessibility Report

Date: 2026-08-17
Branch: `feature/accessibility-development`
Reviewer: accessibility-reviewer agent

## Scope

`frontend/src/App.tsx`, `frontend/src/components/CameraCapture.tsx`,
`frontend/src/components/FoodResult.tsx`, `frontend/src/components/ReferenceImage.tsx`,
`frontend/src/styles/app.css` (plus `frontend/src/styles/tokens.css` for the CSS custom
properties referenced by `app.css`).

This branch had already been through a prior accessibility pass (permanent live regions,
focus management on result arrival, a visually-hidden file input, an audited colour token
file, safety-critical allergen styling). This report re-verifies that work and covers what
remains or is newly at risk. Two of the documented contrast ratios in `tokens.css` were
independently recomputed by hand (relative-luminance formula) and matched to two decimal
places.

## Findings

### 1. Medium — Camera status/error message live region is not persistently mounted

**File:** `frontend/src/components/CameraCapture.tsx:321-325`

```tsx
{
  message ? (
    <p className="camera__hint" role="status">
      {message}
    </p>
  ) : null
}
```

This node is created at the same time as the text it announces. Assistive technology only
reliably announces changes to a live region that _already existed_ — a region created at the
same moment as its content is frequently missed. `App.tsx:267-274` and `FoodResult.tsx:269-271`
both use a permanently-mounted `<p role="status" aria-live="polite">` whose text changes; this
component doesn't follow that pattern, for messages that carry real content ("camera not
available," "please choose a JPEG/PNG/WebP," "image too large," "camera not ready yet"). A
screen reader user who denies camera permission or picks an oversized file may hear nothing.

**WCAG:** 4.1.3 Status Messages (AA).

**Fix:** Mount the `<p role="status" aria-live="polite">` unconditionally and toggle only its
text content (e.g. `{message ?? ''}`).

### 2. Low/Medium — Focus is returned to the wrong control after a successful photo capture

**File:** `frontend/src/components/CameraCapture.tsx:94-107` (focus-management effect),
interacting with `158-185` (`capturePhoto`) and `App.tsx:254-265` ("Identify this food" button).

The focus effect moves focus to the "Use camera" button whenever `status` transitions away from
`'live'` to anything else. `capturePhoto` sets `status` to `'idle'` on a successful capture, same
as turning the camera off deliberately or losing permission. So after a keyboard/screen-reader
user successfully takes a photo, focus lands back on "Use camera" — the control they just
finished with — rather than on "Identify this food," the obvious next step.

**WCAG:** Not a strict failure of 2.4.3 (Focus Order), but undermines its intent and the app's
own stated design goal.

**Fix:** Distinguish "capture succeeded" from "camera turned off / became unavailable" in the
focus effect; don't auto-focus "Use camera" on a successful-capture transition to `'idle'`, and
move focus toward "Identify this food" instead.

### 3. Low, inferred — Decorative CSS `::before` icons may be exposed to assistive tech inconsistently

**File:** `frontend/src/styles/app.css:149-152, 300-303, 361-364`

```css
.panel--notice h2::before { content: 'ℹ️ '; ... }
.allergens__heading::before { content: '⚠️ '; ... }
.disclaimer::before { content: 'ℹ️ '; ... }
```

CSS generated content is sometimes included in accessible-name/description computation, and
emoji glyph pronunciation is inconsistent across NVDA/JAWS/VoiceOver. Because these elements sit
inside content that is deliberately focused programmatically for announcement (`App.tsx:304,330`;
`FoodResult.tsx:180`), an inconsistent prefix could land right when a user is listening for the
actual message. Not confirmed by rendering — flagged as a risk to verify.

**WCAG:** 1.1.1 Non-text Content (indirectly).

**Fix (if certainty is wanted over relying on current browser behaviour):** move the icon into
markup as `<span aria-hidden="true">ℹ️ </span>` ahead of the heading text, since `aria-hidden`
cannot be applied to a pseudo-element.

### 4. Low, cosmetic/inferred — `.reference-figure` has no margin reset

**File:** `frontend/src/styles/app.css:315-319` (only `.reference-figure__img` is styled; no
rule for the `<figure className="reference-figure">` wrapper in `ReferenceImage.tsx:48`)

The browser default UA stylesheet gives `<figure>` `margin: 1em 40px`. At a 375px viewport
(the design floor noted in this file), that's 80px of unstyled horizontal margin swallowed from
an `.app` content width of roughly 343px. Not confirmed visually — inferred from the absence of
a resetting rule plus the standard UA stylesheet.

**Fix:** add `margin: 0` (or `margin: 0 0 var(--space-xs)`) to `.reference-figure`.

## Areas checked with no confirmed issues

- **Colour contrast (tokens.css):** `--color-text-muted` on white (7.93:1, documented 7.92:1)
  and `--color-allergen-accent` on `--color-allergen-bg` (7.43:1, exact match) both recomputed
  independently and confirmed. Both light and dark themes clear 4.5:1 for all listed text pairs.
- **Safety-critical allergen content:** `FoodResult.tsx:220-236` and `app.css:274-313` render
  allergens at inherited body size, in full-contrast text, inside a 2px-bordered panel that also
  clears 3:1 as a non-text boundary — correctly not de-emphasised.
- **Alt text quality:** `ReferenceImage.tsx` makes `alt` a required prop; `FoodResult.tsx:31-52`
  builds alt text from dish name and description with sentence-aware truncation, not a generic
  placeholder.
- **Keyboard access to file upload:** `CameraCapture.tsx:308-318` and `app.css:200-236` use a
  clip-based `.visually-hidden` (not `display:none`), keeping the `<input type="file">` focusable
  and in tab order, with `:focus-within` painting the ring on the visible `<label>`.
- **Live regions for async state:** `App.tsx` and `FoodResult.tsx` both use permanently-mounted
  `role="status"` regions with text-only updates; error panels use `role="alert"`; loading/error
  state is not double-announced through both channels at once.
- **Focus management on result arrival:** `App.tsx:139-144` focuses the first `<h2>` inside the
  result region for both success and error outcomes.
- **Text-to-speech:** `FoodResult.tsx:74-161` reads recipe steps via `SpeechSynthesisUtterance`,
  gated behind real feature detection (`speechSupported()`). The control is a real `<button>`
  with `aria-pressed`; start/stop/finish/error states are separately announced via a persistent
  live region; speech is torn down on new results or unmount.
- **Heading structure:** `h1` → `h2` → `h3`, no skipped levels across the five files reviewed.
- **Touch targets:** `--touch-target: 44px` enforced via `min-height`/`min-width` on `.btn` and
  `.upload-control`, so it survives text wrap and user font-size changes.
- **Reduced motion:** `app.css:399-410` respects `prefers-reduced-motion` for the loading
  animation and shortens transitions globally.
- **Untrusted model output:** No `dangerouslySetInnerHTML` anywhere in the five files; all
  model-derived text is rendered as plain React children.

## Suggested priority order for fixes

1. `CameraCapture.tsx:321-325` — mount the status/error message region persistently.
2. `CameraCapture.tsx:94-107` — fix focus destination after a successful capture.
3. `app.css:149-152, 300-303, 361-364` — replace CSS-generated emoji icons with `aria-hidden`
   markup if certainty is wanted over inferred risk.
4. `app.css` — add a margin reset for `.reference-figure`.
