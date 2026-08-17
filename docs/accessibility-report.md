# Accessibility Report

Date: 2026-08-17 (initial), updated 2026-08-18
Branch: `feature/accessibility-development`
Reviewer: accessibility-reviewer agent

## Scope

`frontend/src/App.tsx`, `frontend/src/components/CameraCapture.tsx`,
`frontend/src/components/FoodResult.tsx`, `frontend/src/components/ReferenceImage.tsx`,
`frontend/src/styles/app.css`, `frontend/src/styles/tokens.css`.

This branch had already been through a prior accessibility pass (permanent live regions,
focus management on result arrival, a visually-hidden file input, an audited colour token
file, safety-critical allergen styling) before the 2026-08-17 review below. The 2026-08-18
update re-verifies the 2026-08-17 findings against `origin/main` (which had, in the meantime,
merged a fix commit plus an unrelated mobile-integration and OpenAI-provider-migration
changeset touching the same files) and adds a fresh pass plus a separate legal/regulatory
compliance gap-analysis.

## 2026-08-18 update — status of prior findings + new issues

Re-review performed after `feature/accessibility-development` fast-forward merged
`origin/main` (commit `5769558`, "Fix live region mounting, icon announcements, figure
margin, and document the conventions", plus unrelated mobile-integration and Gemini→OpenAI
migration changes touching the same files).

| #   | 2026-08-17 finding                                           | Status                                                |
| --- | ------------------------------------------------------------ | ----------------------------------------------------- |
| 1   | Camera status/error live region not persistently mounted     | **Fixed**                                             |
| 2   | Focus returned to wrong control after successful capture     | **Partially fixed — see Finding A, a new regression** |
| 3   | Decorative CSS `::before` icons inconsistently exposed to AT | **Fixed**                                             |
| 4   | `.reference-figure` missing margin reset                     | **Fixed**                                             |

**1 — Fixed.** `CameraCapture.tsx:383-385` now renders
`<p className="camera__hint" role="status" aria-live="polite">{message ?? ''}</p>`
unconditionally, matching `App.tsx:275-277` and `FoodResult.tsx:284-286`. `app.css:189-191`
collapses it visually via `:empty` when there's nothing to say. Corroborated by
`CameraCapture.test.tsx:259`.

**3 — Fixed.** Icons are now real markup: `<span aria-hidden="true">ℹ️ </span>` /
`<span aria-hidden="true">⚠️ </span>` in `App.tsx:308` and `FoodResult.tsx:181, 197, 236, 306`.
No `content:` icon rules remain in `app.css` (confirmed by reading the full file); the
stylesheet documents why the CSS approach was abandoned.

**4 — Fixed.** `app.css:321-324`: `.reference-figure { margin: 0; padding: 0; }`, with a
comment explaining the 375px-width rationale.

### A. Medium — Focus now drops to `<body>` after a successful capture (regression on prior #2)

**File:** `frontend/src/components/CameraCapture.tsx:141-159, 202-232, 228, 308-339`

The fix for prior finding #2 added a `capturedRef` that correctly stops the effect from
pulling focus back onto "Use camera" after a successful capture — but it only _skips_ the
refocus, it doesn't _forward_ focus anywhere. When `status` flips from `'live'` to `'idle'` on
a successful capture, the JSX switches from the `Take photo / Turn camera off` fragment to a
single `Use camera` button — a different element at that tree position, so React unmounts the
previously-focused "Take photo" button. Because `capturedRef.current` is true on this
transition, the effect returns early without calling `.focus()` on anything. Per standard
browser behaviour, when the focused element is removed from the DOM, focus falls back to
`<body>` — the exact failure mode the file's own comment at `CameraCapture.tsx:66-71` says the
ref/effect machinery exists to prevent. Net effect: a keyboard/screen-reader user who
successfully takes a photo now loses focus entirely, which is worse than the original
"wrong-but-real button" bug it replaced. Not covered by a test — `CameraCapture.test.tsx` has
no assertion on `document.activeElement` after a successful `capturePhoto()` (unlike
`App.test.tsx:110-121`, which does assert focus for the result heading).

**Related, narrower issue (new, Low):** if the camera is `'live'` and the user chooses
**Upload a photo** instead, `handleFileChange` (`CameraCapture.tsx:234-278`) also sets
`status` to `'idle'` (line 268), but `capturedRef` is never set for the upload path — so the
focus effect runs its normal branch and calls `useCameraButtonRef.current?.focus()`, yanking
focus away from the file input/label the user was just interacting with, onto a button they
didn't touch.

**WCAG:** 2.4.3 Focus Order (A).

**Fix:** Forward a ref/callback down to the "Identify this food" button (`App.tsx:256-263`)
and explicitly focus it once it mounts after a successful capture or upload, instead of
leaving both transitions to fall through to nothing (capture) or the wrong control (upload).

### B. Low — Stale status message can survive a successful capture

**File:** `frontend/src/components/CameraCapture.tsx:202-232` (`capturePhoto`)

`capturePhoto`'s success path never calls `setMessage(null)`. If a user previously triggered a
message (e.g. "The camera is not ready yet. Try again in a moment.") and then succeeds on a
later attempt, that text remains in the permanently-mounted `role="status"` region sitting
under the new preview image — a stale, contradictory message next to a photo that clearly was
captured. `startCamera` and `handleFileChange` both clear the message on success; `capturePhoto`
doesn't.

**Fix:** Add `setMessage(null)` at the top of the success path in `capturePhoto`.

### C. Informational — dead CSS selector

**File:** `frontend/src/styles/app.css:154-158` (`.panel__heading`)

No JSX in `frontend/src` uses `className="panel__heading"`. Not an accessibility defect —
housekeeping only.

### Re-confirmed as OK in this pass

Colour tokens (allergen contrast pairs re-spot-checked in both themes, still clear 4.5:1;
allergen text still full-size/full-contrast, not de-emphasised), alt text quality, keyboard
access to file upload, live-region/async-state pattern, text-to-speech implementation, heading
structure (h1→h2→h3, no skips), 44px touch targets, unblocked pinch-zoom, `prefers-reduced-motion`
support, and no `dangerouslySetInnerHTML` anywhere in `frontend/src`.

### Updated priority order for fixes

1. `CameraCapture.tsx:141-159, 202-232` — restore forward focus to "Identify this food" after a
   successful capture instead of dropping focus to `<body>` (Finding A).
2. `CameraCapture.tsx:202-232` — clear `message` on a successful capture (Finding B).
3. `CameraCapture.tsx:141-159, 234-278` — don't yank focus onto "Use camera" when a file is
   uploaded while the camera was live (related note under Finding A).
4. `app.css:154-158` — remove the unused `.panel__heading` rule (housekeeping).

---

## Legal & regulatory compliance gap-analysis (2026-08-18)

> **This section is a preliminary engineering-level gap-analysis, not legal advice.** It was
> produced by reading the codebase and pulling publicly available policy/regulatory text. It
> is not a compliance determination and must not be represented to users, customers, or
> regulators as one. Several external sources used below are mirrors/secondary sources rather
> than primary legal text, and are flagged inline where that applies. Qualified counsel and/or
> the project's Data Protection Officer should review everything below before any compliance
> claim is made externally.

### 1. GDPR relevance

**Data flow:** the frontend captures a photo (camera → canvas re-encode, or file upload →
`FileReader.readAsDataURL`), POSTs it as a base64 data URL to `POST /api/analyze`, and the
backend forwards it to OpenAI's `chat.completions.create` (`backend/src/services/aiService.ts`).
The identified dish name is separately sent to the Wikimedia Commons API for a reference image
(`backend/src/services/imageService.ts`) — a second third-party recipient not named in the
in-app disclosure.

**No persistence, no accounts:** confirmed by reading the code — `aiService.ts` explicitly
avoids logging image bytes, API keys, or model output; no database, file write, or cache of
the image exists anywhere in the backend; there's no auth/session/user-ID concept anywhere.

**Gap — EXIF/location metadata:** the live-camera path re-encodes via `<canvas>`, which strips
EXIF as a side effect. The **file-upload fallback path does not** — `handleFileChange` reads
the original file directly with no re-encoding step, and there's no EXIF-stripping dependency
in `backend/package.json`. A photo chosen via "Upload a photo" can therefore carry its original
EXIF block (potentially GPS coordinates, device make/model, timestamp) through to OpenAI
unmodified — in tension with the explicit "no location... is collected or stored" claims in
`AGENTS.md`, `README.md`, and `docs/project-plan.md`.

**Gap — IP addresses:** `backend/src/middleware/rateLimit.ts` keys rate limiting per-client IP
(in-memory, not persisted/logged), which is commonly treated as personal data under GDPR
(Recital 30; CJEU _Breyer_, C‑582/14) and isn't mentioned in any user-facing text.

**Disclosure:** `App.tsx`'s footer does state photos are sent to OpenAI, are not stored by the
app, and that there's no account/location/tracking — a real and reasonably specific
disclosure, but not a formal privacy notice (no controller identity, no legal-basis statement,
no data-subject-rights information, no supervisory-authority contact). No such document exists
anywhere in the repo.

**Gap — dangling reference:** `docs/project-plan.md` itself defers OpenAI retention/training
terms to "the compliance review," but **no such document exists in the repo** — this is an
open item the project already flagged and never resolved. Whether the team's OpenAI account
has accepted OpenAI's DPA or enabled Zero Data Retention is an account-level setting that can't
be determined from code.

**Articles to flag for legal review:** Art. 5(1)(c) minimisation (EXIF gap), Art. 6 lawful
basis (undocumented), Art. 13 transparency (partial disclosure only), Art. 28 processor
obligations (DPA status with OpenAI unverified), Art. 44–49 international transfers (OpenAI
processes in the US; SCC status unverified). Minor items: undisclosed IP processing, and
Wikimedia Commons as an undisclosed second recipient.

### 2. EU AI Act — Article 16(l) and high-risk classification

Source: [artificialintelligenceact.eu/article/16](https://artificialintelligenceact.eu/article/16/)
and [.../annex/3](https://artificialintelligenceact.eu/annex/3/) — a widely used consolidated
mirror of Regulation (EU) 2024/1689, **not EUR-Lex itself** (direct EUR-Lex fetches were
blocked/truncated during research; legal should re-pull the primary text at
[eur-lex.europa.eu/eli/reg/2024/1689/oj](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)
before relying on this for sign-off).

**Article 16(l), as fetched:** requires providers of high-risk AI systems to _"ensure that the
high-risk AI system complies with accessibility requirements in accordance with Directives
(EU) 2016/2102 and (EU) 2019/882."_ It is one of a list of provider obligations (16(a)–(k)
cover conformity assessment, CE marking, registration, corrective actions, logs, etc.) that
only bind **providers of high-risk AI systems**.

**Annex III high-risk categories** (as fetched): biometrics, critical infrastructure,
education/vocational training, employment/worker management, essential-services eligibility
(benefits, credit, insurance), law enforcement, migration/asylum/border control, and
justice/democratic processes.

**Assessment:** Cultural Food Guide (food identification/recipe/allergen assistant) does not
plausibly fall into any of the eight Annex III categories, checked against the fetched Annex
III text rather than assumed. On that basis, Article 16 as a whole — including the 16(l)
accessibility duty — does not appear to attach to this app, because it isn't a high-risk
system under the Act's own scoping.

**Article 50 (general transparency)** applies independently of high-risk status: AI systems
"intended to interact directly with natural persons" must make that fact clear to users unless
obvious from context. The app already discloses AI generation prominently (footer text, plus a
mandatory `disclaimer` field on every API response). Whether 50(1) strictly applies to a
photo-in/structured-JSON-out assistant (versus a conversational chatbot) is a genuine judgment
call that needs legal, not engineering, sign-off — but the existing disclosure is very likely
sufficient in substance even if its strict applicability is debatable.

**Gap to flag:** confirm the Annex III non-match with counsel (a future feature touching
health/insurance-style eligibility scoring could change this), and confirm whether Article
50(1) is engaged and whether the existing disclosure text satisfies it.

### 3. Fundamental Rights Impact Assessment (FRIA)

Source: [artificialintelligenceact.eu/article/27](https://artificialintelligenceact.eu/article/27/)
(same EUR-Lex verification caveat as above).

**Confirmed: Article 27** is the FRIA provision, and it binds: (a) bodies governed by public
law, (b) private entities providing public services, or (c) deployers of Annex III points
5(b)/5(c) specifically (creditworthiness/credit-scoring, life/health insurance risk-assessment)
regardless of public/private status. Critical infrastructure (Annex III point 2) is explicitly
carved out of the FRIA duty even though it is itself high-risk.

**Assessment:** two independent reasons this doesn't plausibly apply — (1) §2 above found no
Annex III match at all, and Article 27 only binds deployers of already-high-risk systems; (2)
even setting that aside, the project isn't a public-law body or public-service provider, and
doesn't do credit-scoring or insurance risk/pricing. Both legs should be confirmed by legal,
especially if the product's scope changes later.

### 4. OpenAI's data-retention and training policy vs. what the code does

Primary source: [developers.openai.com/api/docs/guides/your-data](https://developers.openai.com/api/docs/guides/your-data)
(current canonical location as of this session). Secondary sources for DPA specifics only
(direct fetch of `openai.com/policies/data-processing-addendum/` returned HTTP 403 during
research — re-verify directly): a compliance-vendor GDPR/API setup guide and a legal-tools
summary page.

**What OpenAI currently publishes:**

- **Training:** API data is **not used for model training by default**, unless the account
  explicitly opts in.
- **Retention:** abuse-monitoring logs are retained **up to 30 days by default**; most
  endpoints store no persistent "application state" by default (varies by endpoint).
- **Zero Data Retention (ZDR):** available, but requires prior approval and org-level
  enablement via account settings/sales — **not** a per-request parameter an application can
  set itself.
- **DPA:** per secondary sources (needs primary confirmation), incorporated into the Services
  Agreement effective 2026-01-01, but a business account must still affirmatively accept it;
  personal accounts cannot execute it. International transfers reportedly rely on SCCs, with
  OpenAI Ireland Ltd. handling EEA/Swiss customer data while underlying storage is in the US.

**Comparison against `backend/src/services/aiService.ts`:** the OpenAI client is instantiated
plainly (`new OpenAI({ apiKey })`) and calls are standard `chat.completions.create(...)` with
no retention/training opt-out parameter, no `store: false`, and no ZDR-related override
anywhere in the code. Nothing in the repo records whether the team's shared OpenAI account has
accepted the DPA or enabled ZDR — this is exactly the open item `docs/project-plan.md` defers
to a "compliance review" that was never produced (see §1).

**Gap to flag:** (1) confirm whether the shared OpenAI account is a business account that has
accepted the current DPA; (2) decide whether the default 30-day abuse-monitoring retention is
acceptable given the "photos are not stored by us... discarded once the result is returned"
footer language, which is scoped to "by us" but could read as broader; (3) ZDR/training
opt-out, if wanted, must be pursued as an OpenAI account action, not a code change; (4)
re-verify the DPA/SCC specifics directly against `openai.com/policies/data-processing-addendum/`.

### Disclaimer

This section is an engineering-level gap analysis, not legal advice, and does not constitute a
compliance determination. Sources that are mirrors or secondary summaries rather than primary
legal/policy text are flagged inline above; legal/DPO should re-verify against EUR-Lex (CELEX
32024R1689) and OpenAI's own policy pages directly before any compliance claim is finalized.
