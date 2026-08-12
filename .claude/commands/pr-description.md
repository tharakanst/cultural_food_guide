---
description: Generate a pull request description from the current branch's changes
---

Write a pull request description for the current branch.

Gather the actual changes first:

```bash
git diff main...HEAD --stat
git log main..HEAD --oneline
```

Then read the changed files. Describe what the code does, not what the commit
messages claim it does.

## Format

**Title** — one line, imperative mood, no ticket prefix.

**What changed** — two or three sentences in plain language. A teammate reading
this without opening the diff should understand what is now different.

**Why** — the reason for the change. If it implements something from
`docs/project-plan.md`, reference which part.

**How to test** — concrete steps a reviewer can follow. For UI changes, what to
click and what should happen. For API changes, the request and expected response.

**Review focus** — where reviewers should look hardest. Be honest about the parts
you are least confident in; that is more useful than a uniform request to review
everything.

**Checklist** — only items that genuinely apply:
- [ ] `npm run verify` passes
- [ ] No secrets in the diff
- [ ] Accessibility considered (contrast, alt text, keyboard, screen reader)
- [ ] Documentation updated if behaviour changed

## Rules

Do not claim tests pass without running them.

If the branch mixes unrelated changes, say so — suggest splitting rather than
writing a description that makes an incoherent PR sound coherent.

Keep it short. Four reviewers on a one-week project will not read three screens
of description.
