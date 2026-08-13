# Cultural Food Guide — Agent Instructions

Project context for all AI coding agents working in this repository. This is the
canonical instruction file. `CLAUDE.md` points here; do not duplicate content there.

## What this project is

A web app that identifies food from a photo — a menu, a packaging label, or a
dish — and returns its ingredients, dietary and allergen information, and local
cultural context. Built for exchange students and visitors in Finland who can
read a translation but still can't tell whether something is safe to eat or how
it's normally served.

Full scope in [docs/project-plan.md](docs/project-plan.md).
Architecture and design decisions in [docs/architecture.md](docs/architecture.md).

## Team

Four members, one week, coursework project (INF2335, Turku UAS). Members use
different AI tools: Claude Code (×2), Codex (×1), ChatGPT web (×1). Keep anything
that must work for everyone at the git or npm layer, not in tool-specific config.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite + TypeScript, plain CSS with custom properties |
| Mobile | PWA — installable, responsive, uses the device camera |
| Backend | Node + Express + TypeScript |
| AI | Google Gemini Flash (free tier), multimodal — OCR and identification in one call |
| Reference images | Wikimedia Commons API (no key required) |
| Testing | Vitest, React Testing Library, Supertest |

## Architecture

Layered monolith, client-server. Each layer only talks to the one below it:

```
React components          presentation
      ↓ HTTP
routes/analyze.ts         API layer — validation, HTTP concerns
      ↓
services/aiService.ts     service layer — AI call, prompt, response parsing
      ↓
Gemini API                external
```

The reason this matters in practice: the AI provider is isolated in the service
layer, so swapping providers is a one-file change. Do not call the AI API from a
route handler or a component.

## Hard constraints

These are not style preferences. Breaking them breaks the project's stated
commitments in the project plan.

1. **The AI API key never reaches the client.** It lives in `backend/.env` and is
   read only by the service layer. The frontend calls our backend, never Gemini
   directly. Do not "simplify" by moving the call into React.
2. **No personal data is collected or stored.** No location, no identifiers, no
   accounts, no persistence of uploaded images. The project plan commits to this.
3. **Model output is untrusted input.** Never render it with
   `dangerouslySetInnerHTML`. A photographed menu is arbitrary real-world text and
   is a legitimate prompt-injection surface.
4. **Allergen information must never be visually de-emphasised.** It is
   safety-critical content. Low-contrast or small-print allergen text is a bug,
   not a design choice.

## Conventions

- TypeScript on both frontend and backend. The `/api/analyze` response type is
  shared so the two sides cannot drift.
- Formatting is handled automatically — do not hand-format or reformat unrelated
  lines.
- Keep route handlers thin: validation and HTTP only. Logic belongs in services.
- Errors returned to the client are generic. Details go to server logs.

## API contract

**Defined once in [`shared/types.ts`](shared/types.ts). Import it — do not
redeclare these shapes on either side.**

```ts
import type { AnalyzeRequest, AnalyzeResponse, ApiError } from '../../shared/types'
```

The file is types-only by design: TypeScript erases `import type` at compile
time, so a plain relative path works from both sides with no path aliases,
bundler config, or workspace setup. Do not add runtime values to it — that
would break this property.

`POST /api/analyze` takes `AnalyzeRequest` and returns `AnalyzeResponse`, or
`ApiError` with a non-2xx status.

Two fields carry requirements worth knowing before you use them:

- **`identified: boolean`** — false when the photo could not be identified as
  food. The frontend must then show an honest "could not identify this" state
  rather than rendering a guess as a result.
- **`allergens: string[]`** — safety-critical, and must state uncertainty
  explicitly when the model is inferring rather than reading a label.

## Shared constants

Values both sides need are duplicated rather than shared, because putting
runtime values in `shared/types.ts` would break its zero-config property. Keep
these in sync:

| Constant | Value |
|---|---|
| Max image payload | 10 MB |
| Accepted image types | `image/jpeg`, `image/png`, `image/webp` |

## Running it

```bash
npm run install:all     # first time
npm run dev             # backend :4000, frontend :5173
npm run verify          # build, tests, startup check
```

Set up the shared git hooks once after cloning:

```bash
git config core.hooksPath .githooks
```

## Branch workflow

`main` holds working code only. Work happens on `feature/*` branches and merges
via pull request so the team reviews each other's work. A git hook blocks direct
commits to `main`.

## Specialist agents

Role definitions live in `.claude/agents/`. They are plain markdown — the body
below the YAML frontmatter is a system prompt.

| Agent | Use for |
|---|---|
| `llm-integration` | Prompt tuning, output reliability, the Gemini call |
| `accessibility-reviewer` | WCAG review — contrast, alt text, keyboard, screen reader, TTS |
| `test-designer` | Test cases and blind-spot analysis |
| `doc-generator` | Technical documentation generated from code |
| `frontend-expert` | React component implementation |
| `backend-expert` | Express route and service implementation |

**If you are not using Claude Code:** these are not invoked automatically for you.
Open the relevant file in `.claude/agents/`, copy everything below the `---`
frontmatter, and use it as your instructions for that task. The content works in
any tool; only the automatic invocation is Claude Code specific.

Reusable prompts live in `.claude/commands/` and work the same way.
