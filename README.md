# Cultural Food Guide

Photograph a dish, a menu, or a food label and get back what it is, what's in it,
which allergens it may contain, and how it fits into local food culture. Built for
exchange students and visitors in Finland who can read a translation but still
can't tell whether something is safe to eat or how it's normally served.

Secure, Accessible and Efficient AI-Assisted Software Development coursework project, Turku UAS.

- [Project plan](docs/project-plan.md): scope, goals, ethics and privacy commitments
- [Architecture](docs/architecture.md): layers, decisions, rejected alternatives
- [AGENTS.md](AGENTS.md): instructions for AI coding agents

## Setup

**Read all three steps before starting.** Step 2 fails silently if skipped:
nothing breaks visibly, the protection just isn't there.

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Enable the shared git hooks

```bash
git config core.hooksPath .githooks
```

Git hooks live in `.git/hooks`, which is not committed, so this points git at the
committed `.githooks/` folder instead. Without it you lose the pre-commit secret
scan and the block on committing directly to `main`.

**Run this once per clone, on every machine.**

### 3. Set the Gemini API key

The team shares one key unless you want to create your own. The free tier allows 1,500 requests per day, which is comfortably enough for four
people during this project.

```bash
cd backend
cp .env.example .env
```

Then open `backend/.env` and set `GEMINI_API_KEY=` to the shared key.

`.env` is gitignored and a hook blocks agents from reading it. **Never commit it,
and never paste the key into a chat, an issue, or a commit message** — a shared
key means one careless paste exposes it for everyone, and rotating it means all
four of you have to update `.env` again.

## Running it

One command from the repository root starts both servers:

```bash
npm run dev
```

- Backend: http://localhost:4000
- Frontend: http://localhost:5173

Or separately, if you want isolated logs:

```bash
npm run dev --prefix backend
```

```bash
npm run dev --prefix frontend
```

### Testing on a real phone

```bash
npm run dev --prefix frontend -- --host
```

This exposes the dev server on your local network. Note that the camera will not
work over a plain LAN IP: `getUserMedia` requires HTTPS on anything that is not
`localhost`. Use a tunnel (ngrok) or add `@vitejs/plugin-basic-ssl` for a real
HTTPS URL. The file-upload fallback works regardless.

## Checks before you commit

```bash
npm run verify
```

Runs type-checking, tests, and the production build across both sides.

## Project structure

```
AGENTS.md              project context — read by Codex natively, Claude via CLAUDE.md
CLAUDE.md              pointer to AGENTS.md
shared/types.ts        the API contract — imported by both sides, never redeclared
.claude/               agents, commands, hooks (Claude Code only)
.githooks/pre-commit   secret scan + main-branch block (everyone, any tool, any OS)
docs/                  project plan and architecture
backend/               Express + TypeScript. Holds all secrets and external API access
  AGENTS.md            layer-specific rules
  src/routes/          HTTP, validation, status codes
  src/services/        AI call, Wikimedia lookup
frontend/              React + Vite + TypeScript, delivered as an installable PWA
  AGENTS.md            layer-specific rules
  src/components/      camera capture, result display, reference image
```

## Working as a team

`main` holds working code only. Work on a branch and open a pull request so
someone else reviews it — a pre-commit hook blocks committing directly to `main`.

```bash
git checkout -b feature/your-change
```

### AI agents

Six specialist agents live in `.claude/agents/`. In Claude Code they can be
invoked by name. **If you use Codex or ChatGPT**, they are not invoked
automatically for you — open the relevant file, copy everything below the `---`
frontmatter, and use it as your instructions. The content works in any tool; only
the automatic invocation is Claude Code specific.

One setup note for any Claude surface, including the VS Code extension: `.claude/`
is loaded from whichever folder is opened as the project. Open
`cultural_food_guide` itself, not a parent folder — opened one level up, the
agents and hooks silently do not exist, with no error to tell you. Restart after
pulling changes that touch `.claude/`, since it is read once at startup.

| Agent                    | Use for                                            |
| ------------------------ | -------------------------------------------------- |
| `frontend-expert`        | React components, PWA, responsive layout           |
| `backend-expert`         | Express routes, services, middleware               |
| `llm-integration`        | Prompt tuning, output reliability, the Gemini call |
| `accessibility-reviewer` | WCAG review — read-only, reports rather than edits |
| `test-designer`          | Test cases and blind-spot analysis                 |
| `doc-generator`          | Technical documentation from code                  |

Implementation agents build; review agents assess. Keep them separate — reviewing
your own work reproduces its blind spots.

Commands: `/prep-submit`, `/sync-plan`, `/pr-description`.

## Non-negotiables

These are in `AGENTS.md` too, but they matter enough to repeat:

1. **The API key never reaches the client.** It lives in `backend/.env`, read only
   by the service layer. Do not "simplify" by calling Gemini from React — that
   ships your key to every visitor in the JavaScript bundle.
2. **No personal data is collected or stored.** No location, no identifiers, no
   accounts, no saved images. The project plan commits to this.
3. **Model output is untrusted.** Never render it with `dangerouslySetInnerHTML`.
   A photographed menu is arbitrary real-world text.
4. **Allergen information is safety-critical** and is never visually
   de-emphasised. Small or low-contrast allergen text is a bug.

## Known limitations

- Free tier allows 15 requests per minute, which could throttle a live demo if
  several people use it at once
- Cultural claims are not verified against any source
- Wikimedia reference images are matched by dish name and are sometimes wrong or
  absent
- Analysis requires connectivity — the PWA shell caches, the analysis does not
- iOS Safari PWA behaviour is untested
- The frontend test suite is intermittently slow or flaky on Windows
