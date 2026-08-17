# Architecture

Design decisions for Cultural Food Guide, and the reasoning behind them.
Scope in [project-plan.md](project-plan.md).

## Chosen pattern: layered monolith

A single deployable application, internally organised into layers where each
layer only communicates with the one below it.

```
┌─────────────────────────────────────────┐
│  Presentation — React components        │
│  Camera capture, result display, TTS    │
└──────────────────┬──────────────────────┘
                   │  HTTP (JSON)
┌──────────────────▼──────────────────────┐
│  API layer — routes/analyze.ts          │
│  Validation, status codes, rate limits  │
└──────────────────┬──────────────────────┘
                   │  plain function calls
┌──────────────────▼──────────────────────┐
│  Service layer                          │
│  aiService — prompt, provider, parsing  │
│  imageService — reference image lookup  │
└─────────┬───────────────────┬───────────┘
          │                   │
┌─────────▼────────┐ ┌────────▼───────────┐
│  OpenAI API      │ │ Wikimedia Commons  │
└──────────────────┘ └────────────────────┘
```

### Why this pattern

Monolith, because the application has one meaningful operation and a team of
four working for one week. There is no independent scaling need and no domain
boundary that would justify separate deployments.

Layered, because the separation earns its keep immediately rather than
theoretically:

- **Provider independence.** The AI call exists only in `aiService`. This has now
  been exercised twice: once from Claude to Gemini during planning, and again
  from Gemini to OpenAI at the end of the project. The second switch touched the
  service file and its tests; the route layer, the frontend, and the API contract
  in `shared/types.ts` needed no changes at all. That is the layering paying for
  itself in the only way that counts — a provider change that did not become an
  application change.
- **Secret containment.** Only the service layer reads the API key. Because the
  presentation layer is physically separated by an HTTP boundary, there is no
  path by which a key can reach the browser bundle by accident.
- **Testability.** Services take plain arguments and return plain data, so they
  can be tested with mocked provider responses and no HTTP server.

## Rejected alternatives

**Microservices.** Would split one meaningful operation across network
boundaries, adding latency, distributed failure modes, and deployment overhead in
exchange for scaling and team-autonomy benefits this project cannot use. The
architecture would cost more than it returns at four developers and one endpoint.

**Event-driven.** Would decouple image submission from analysis via a queue. The
only scenario that justifies it is analysis becoming slow enough that holding an
HTTP request open is unacceptable. At current scale — a single synchronous
provider call of a few seconds — it adds eventual consistency and tracing
difficulty for no benefit. It is the correct choice if this app ever needed to
process a backlog of images asynchronously.

**Serverless functions.** Viable, and would remove server management. Rejected
because a persistent process makes local development and rate limiting simpler
for a team learning the stack in a week.

## Client-server split

The frontend and backend are separate applications communicating over HTTP rather
than a single server-rendered app. Two consequences:

1. **The API key cannot leak into the client** — the boundary is physical, not a
   convention someone has to remember.
2. **Any future client reuses the backend unchanged.** A React Native app, a
   native mobile app, or a different frontend would consume the same
   `/api/analyze` endpoint. The PWA approach is a presentation decision, not an
   architectural one.

## Quality attributes

| Attribute           | How it is addressed                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Security**        | API key server-side only; input validation; rate limiting; helmet headers; restricted CORS; generic client errors                   |
| **Privacy**         | No data persistence, no accounts, no location, no identifiers. Images are processed in memory and discarded                         |
| **Accessibility**   | WCAG AA contrast, alt text, keyboard operability, screen-reader announcements, text-to-speech. Enforced by a dedicated review agent |
| **Maintainability** | Layer boundaries documented and enforced by per-directory instruction files that all AI tools read                                  |
| **Reliability**     | Model output parsing tolerates malformed responses; camera failure falls back to file upload                                        |
| **Cost**            | OpenAI billed per token (~$0.0006 per analysis). Rate limiting caps worst-case daily spend rather than protecting a quota           |

Scalability is deliberately not optimised for. The system serves a demo and a
small number of concurrent users; designing for load would be speculative.

## Security posture

Security is cross-cutting rather than a layer. What applies here:

- Secrets in environment variables, never committed; a git hook scans staged
  files for key patterns before every commit
- Input validation and payload size caps before any provider call
- Rate limiting on `/api/*`, bounding spend on a shared billed account
- Model output treated as untrusted — never rendered as HTML
- Prompt injection acknowledged as a real vector: the input is a photograph of
  arbitrary real-world text

What deliberately does not apply: authentication, session management, and CSRF
protection. There are no accounts, no logins, and no stored user data. Adding
them would be security theatre.

## AI development toolkit

The repository includes agent definitions, hooks, and commands. The design
constraint is that the team uses three different AI tools — Claude Code (×2),
Codex (×1), ChatGPT web (×1) — so the toolkit is split by what can actually be
shared.

| Mechanism       | Location                                               | Works for                                                    |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Project context | `AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md` | All tools — Codex natively, Claude via pointer, web by paste |
| Guarantees      | `.githooks/pre-commit`, npm scripts                    | All members, any tool, any OS                                |
| Conveniences    | `.claude/` agents, commands, hooks                     | Claude Code; content readable and pasteable by others        |

**The rule applied:** anything that must not be forgotten lives at the git or npm
layer, where it runs regardless of tool. Only conveniences live in tool-specific
config.

Instruction files mirror the architecture layers. A session working in `backend/`
picks up "the API key never leaves this layer" automatically, without anyone
remembering to say it.

### Agent selection

Six specialist agents, chosen from a longer candidate list. An agent earns its own
definition only if context isolation genuinely helps, the work recurs, and it
applies a lens a general-purpose agent would miss.

| Agent                    | Justification                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `llm-integration`        | Prompt tuning is a high-volume try-check-adjust loop whose intermediate output is noise               |
| `accessibility-reviewer` | WCAG failures are invisible to general review because the code still runs correctly                   |
| `test-designer`          | Whoever wrote the code shares its blind spots; a fresh context is better placed to ask what breaks it |
| `doc-generator`          | High read-to-write ratio — traverses many files to emit a short artifact                              |
| `frontend-expert`        | React implementation, scoped to building rather than reviewing                                        |
| `backend-expert`         | Express and service implementation, scoped to building rather than reviewing                          |

Implementation agents build; review agents assess. The separation is deliberate:
reviewing your own work reproduces its blind spots.

Candidates rejected: a project planner (planning needs maximum context, and a
subagent starts with none), and a standalone security agent (a one-time
pre-submission check on a codebase this size is a task, not a role — and the
actual key-leak risk needs a deterministic git hook, not an agent someone has to
remember to summon).

## Known limitations

- API usage is billed per token, so the rate limiter now exists to bound spend
  rather than to preserve a free quota. Worst case with four developers is around
  $0.24/day
- `gpt-5.6-luna` was chosen as the cheapest tier supporting both vision and
  strict structured output. It is less capable than frontier models at nuanced
  cultural reasoning, and whether it reads small Finnish label text as accurately
  as the previous provider has not been measured against real photographs
- Accuracy of cultural claims is not verified against any source
- Wikimedia reference images are matched by dish name and may occasionally be
  wrong or absent
- No offline capability beyond the PWA shell — analysis requires connectivity
- iOS Safari PWA support is more restricted than Android; installed behaviour is
  untested on iOS
