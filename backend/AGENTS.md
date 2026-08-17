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
   OpenAI costs real money on a shared, billed account.
4. **Errors returned to the client are generic.** `{ error: "Failed to analyze
   image" }`. Stack traces and provider errors go to the server log only.
5. **URLs from external APIs are validated before being returned to the client.**
   See the reference image section below. Anything we hand the frontend ends up
   in an `<img src>`, so an unchecked third-party URL is an injection vector.

## Reference image lookup

`imageService` queries the Wikimedia Commons API for a photo of the identified
dish. No API key is required.

The returned image URL is **untrusted third-party data**. Before it is included
in a response:

- Parse it as a URL and reject anything that fails to parse
- Require `https:`
- Require the hostname to be `upload.wikimedia.org` or a `*.wikimedia.org`
  subdomain — an allowlist, not a blocklist
- If validation fails, omit `referenceImageUrl` entirely rather than passing
  through a URL we could not verify

A missing image is a minor degradation. An arbitrary attacker-controlled URL
rendered in an `<img>` tag is not. The frontend's Content-Security-Policy
`img-src` is the second layer; this is the first.

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
