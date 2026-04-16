# Universal AI Collaboration Guide

> **Sync Rule:** This file (`AGENTS.md`) and `CLAUDE.md` must always have identical content.
> If you edit one, you **must** apply the same edit to the other before finishing.

> **Scope:** Global baseline rules for every project under `Code Projects\`.
> A project-level `AGENTS.md` / `CLAUDE.md` **overrides or extends** these rules. Always check for one first.

---

## How I Work With You

- **Ask before doing anything big** — new files, refactors, deletes, or anything touching more than one system.
- **Explain what I'm doing** — when writing or changing non-trivial logic, I'll say what it does and why.
- **Suggest improvements proactively** — I'll flag things worth improving without silently fixing them.
- **Never break working stuff** — if a change could affect existing behavior, I'll call it out before making it.
- **Reviews should be easy to scan** — for PR/code reviews, lead with a short title, basic PR metadata when available, and a clear verdict (`approve`, `needs changes`, `do not merge`). Put the most important findings first under headings like `Hard blockers`, `Other issues`, and `What's fine`, using plain, direct language rather than a vague summary.

---

## Before Touching Anything

1. Read any existing `PROJECT_PLAN.md' in the project root.
2. Understand existing conventions (naming, structure, shared helpers) before writing new code.
3. If something is unclear, ask — don't guess on things that are hard to undo.

---

## Code Style

- **Language:** Match the project's primary language. Apply these principles regardless of language.
- **Version targeting:** Check for a stated target version first. For PowerShell, do NOT use PS 7-only syntax (`&&`, ternary `? :`) unless the project explicitly targets PS 7+.
- **Comments:** Only comment non-obvious logic. If intent isn't clear from the code, explain it.
- **No magic numbers or unexplained strings** — use named variables/constants.
- **Consistent naming** — match existing conventions. Don't introduce a new style mid-codebase.
- **Refactoring scope** — flag nearby messy code and ask before touching it. Never silently refactor beyond the current ask.

---

## Error Handling (Always)

- Every function/script that can fail must handle errors explicitly — no swallowing exceptions silently.
- Use `try/catch` for operations touching external systems (filesystem, network, AD, APIs, registry, etc.).
- On error: log it, show a short user-facing message, then continue or return gracefully. Only `throw`/`raise` if truly unrecoverable.
- Never pass `$null` / `None` / `null` to parameters that don't accept it.

---

## Logging (Always)

- Log every significant action and outcome: what was attempted, against what target, and whether it succeeded or failed.
- Log entries must be identifiable: include timestamp, target, and result (OK / FAIL / Skip).
- Destructive actions (deletes, removals, overwrites) must be clearly logged with enough detail to reconstruct what happened.
- Do not log sensitive values (passwords, tokens, personal data beyond identifiers).
- **Maintain a general/diagnostic log** — in addition to task-specific logs, write all errors, warnings, and notable events to a shared general log file. This log is for diagnosis and debugging: anything unexpected, any caught exception, any degraded state, and any retry/fallback should appear here. It must be machine-readable enough to grep/search and human-readable enough to diagnose an issue without running the code.

---

## Destructive Actions (Always Confirm)

- Before any delete, remove, overwrite, or irreversible change: resolve and display the exact target objects first, then prompt.
- Show enough detail that the user can verify they're doing the right thing.
- Default answer is always **No** / cancel. Affirmative must be explicit.

---

## User-Provided Data

- **User examples are not sample data** — never copy real names, phones, emails, or IDs into code, docs, or tests. Generalize first (e.g. `12345678`, `user@example.com`).

---

## Docs & Consistency

- **Keep docs in sync** — if a change affects how something works, update the README/plan doc in the same pass.
- **Standardized strings** — if something must be consistent across the codebase, change it everywhere and update the docs.

---

## Git

- **Commit after every logical change** — commit with a clear message and **push immediately** in the same step. Group related edits into one commit. Default behaviour is commit **and** push together, not commit alone; only skip the push if the user explicitly says so.
- **Commit messages:** Use conventional commits — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Short, imperative subject line.
- Suggest splitting multi-concern changes into separate commits.

---

## Session Notes

> Projects that span multiple sessions should maintain a **Session Notes** section in their own project-level `AGENTS.md` / `CLAUDE.md`.
> Update at the end of each session with: what was done, decisions made, current state, and what the next session needs to know. Keep it trimmed — forward-relevant only.
