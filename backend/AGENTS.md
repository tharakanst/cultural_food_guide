# Backend — Agent Instructions

Applies to everything under `backend/`. Root [AGENTS.md](../AGENTS.md) still
applies; this file adds rules specific to the API and service layers.

## Responsibility

Node + Express + TypeScript. Receives an image from the frontend, calls the AI
provider, returns structured food information. It holds all secrets and all
external API access.

## Layer boundaries

```
src/routes/analyze.ts     API layer — HTTP, validation, status codes
src/services/aiService.ts service layer — prompt, provider call, parsing
src/services/imageService.ts  service layer — Wikimedia reference image lookup
src/index.ts              bootstrap — middleware, port
```

- Route handlers stay thin: validate input, call a service, shape the response.
  No prompt text, no provider SDK calls, no business logic in routes.
- Services never import Express types. They take plain arguments and return plain
  data, so they can be tested without an HTTP server.

## Hard rules

1. **The API key is read only here, and only from `process.env`.** Never hardcode
   it, never log it, never include it in an error response. `backend/.env` is
   gitignored; `backend/.env.example` is committed with empty values.
2. **Do not log request images or model output containing user content.** The
   project plan commits to collecting and storing nothing.
3. **Validate before calling the provider.** Reject anything that is not an image
   data URL, and enforce the payload size cap. An unvalidated request that reaches
   Gemini costs quota from a shared free tier.
4. **Errors returned to the client are generic.** `{ error: "Failed to analyze
   image" }`. Stack traces and provider errors go to the server log only.

## Model output handling

The provider is asked to return JSON. It will sometimes wrap it in markdown code
fences anyway. Parsing must tolerate that rather than throwing — a failed parse
should produce a clean error, never a 500 with a stack trace.

Treat model output as untrusted: it originates from a photograph of arbitrary
real-world text.

## Security middleware

`helmet` for headers, `express-rate-limit` on `/api/*`. The rate limit protects a
shared 1,500 requests/day free tier — without it a single loop in testing can
exhaust the team's quota.

CORS is restricted to the frontend origin. Do not widen it to `*` to fix a local
problem; set the origin via environment variable instead.

## Testing

Vitest plus Supertest. Services are tested directly with mocked provider
responses — do not call the real API in tests, it costs shared quota and makes
tests non-deterministic.
