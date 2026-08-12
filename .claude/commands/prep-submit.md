---
description: Full pre-submission check — build, tests, security, accessibility, docs, secrets
---

Run a complete pre-submission pass on Cultural Food Guide and report what is not
ready. Work through every section; do not stop at the first failure.

## 1. Mechanical checks

Run `npm run verify` (build, tests, backend startup). Report failures with the
actual output, not a summary.

## 2. Secrets

- Confirm no API key appears anywhere in tracked files
- Confirm `backend/.env` is gitignored and `backend/.env.example` is committed
  with empty values
- Check git history for keys that were committed and later removed:
  `git log -p | grep -iE "AIza|sk-ant|api[_-]?key"`

## 3. Security

Verify against `docs/architecture.md`:
- API key read only in the service layer, never sent to the client
- Rate limiting active on `/api/*`
- CORS restricted, not `*`
- `helmet` in use
- Client-facing errors generic, no stack traces
- No `dangerouslySetInnerHTML` anywhere in the frontend

## 4. Accessibility

Use the `accessibility-reviewer` agent over `frontend/src`. Report its findings
by severity. Allergen-related contrast issues are high severity.

## 5. Plan alignment

Run the same check as `/sync-plan`: every promise in `docs/project-plan.md`
either implemented, or knowingly not — with the gap named.

## 6. Documentation

- `README.md` setup instructions actually work from a clean clone
- `docs/architecture.md` matches the code as built
- No documented feature that does not exist

## Report format

Group findings under **Blocking** (must fix before submission) and
**Non-blocking** (worth knowing). For each: what is wrong, where, and the fix.

End with a plain readiness verdict. If it is not ready, say so directly — an
optimistic report the day before submission is worse than useless.
