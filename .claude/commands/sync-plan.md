---
description: Audit the codebase against the promises made in docs/project-plan.md
---

Compare what `docs/project-plan.md` promises against what the code actually does,
and report every gap.

The project plan is a submitted document. Anything it claims should either exist
in the code, or be a gap the team has knowingly accepted. Silent divergence
between the two is the failure mode this command exists to catch.

## Claims to verify

Read `docs/project-plan.md` in full and check every claim. These need particular
attention:

**Privacy** — "only the captured image is sent for AI processing: no location,
personal identifiers, or other user data is collected or stored". Verify nothing
is persisted, no analytics, no location access, no logging of user content. This
is the strongest factual claim in the document.

**Accessibility** — text-to-speech for recipe steps, readable formatting, alt
text for images. Does TTS exist? Do images have meaningful alt text?

**Reference images** — sourced from the web, explicitly not AI-generated.
Confirm the implementation matches, since the plan states this as a deliberate
ethical choice.

**Allergen handling** — highlighted, with a reminder that AI output does not
replace official labels. Is the disclaimer present and legible?

**Cultural context** — origin, traditions, how the food is served.

**Recipes** — the plan promises recipe information.

**Transparency** — AI-generated content clearly indicated, uncertainty shown
where appropriate.

## Report format

A table: claim, status (implemented / partial / missing), evidence.

Then for each gap, state the two options plainly — implement it, or amend the
plan. Say which you would recommend and why. Amending a submitted plan is a
legitimate choice when scope changed for good reasons; pretending a feature
exists is not.

Do not edit files. Report only.
