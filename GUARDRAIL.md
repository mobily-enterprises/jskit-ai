# AI Code Quality Guardrail

Purpose: prevent low‑quality “AI slop” from entering the repo by enforcing architecture alignment, pattern consistency, and explicit justification for any deviation.

This guardrail is a mix of:
- A prompt that forces correct architectural behavior before code is written.
- A review checklist that flags anti‑patterns and repeated scaffolding.
- CI checks that block common slop patterns.

## Non‑Negotiables

- Follow runtime boundaries (`src/shared`, `src/client`, `src/server`) and package layout rules.
- Respect module registry dependencies when contributing actions or services.
- Prefer existing helpers and patterns over creating new near‑duplicates.
- No “just add a helper” without a clear justification and evidence of reuse.

## Architecture Alignment Checklist (Must Pass)

- Dependencies are declared in module registry when any module references another module’s services.
- Package runtime layout is respected (no client importing server or shared‑only from client).
- Contracts are separated from runtime implementations.
- Schema validation uses established TypeBox patterns and existing schema helpers.

## Anti‑Patterns (Auto‑Reject)

- Copy‑paste helper clones across multiple files (normalize/resolve/require helpers).
- Repeated action/handler boilerplate with only names changed.
- Duplicate Vue client element scaffolding for props/variants/copy handling.
- Large monolithic services that disable lint rules to grow unchecked.
- New “normalization” helpers that mirror existing ones with slight semantic drift.

## CI Guardrails (Enforced)

- Duplication guardrail using `jscpd` with baseline. New duplicate fragments fail CI.
  - Run locally: `npm run lint:duplication`
- Architecture guardrails:
  - `npm run lint:architecture:client`
  - `npm run test:architecture:client`
  - `npm run test:architecture:db`
- Framework checks:
  - `npm run framework:check-import-boundaries`
  - `npm run framework:check-runtime-layout`
  - `npm run framework:check-descriptor-drift`

## Required Pre‑Flight Prompt (Use Before Writing Code)

Use this prompt whenever you start a task in this repo:

```
You are working in the jskit-ai monorepo. Before writing code:
1) Find and reference the closest existing pattern (file path + rationale).
2) List any existing helpers/utilities that should be reused instead of re‑implementing.
3) Explain how your change aligns with the runtime boundaries and module registry dependencies.
4) If you must introduce a new helper or a new pattern, justify why existing ones are insufficient.
5) If you are about to copy boilerplate, stop and propose a shared abstraction instead.

Constraints:
- No duplicate helpers across contributors, services, or client elements.
- No new scaffolding unless it is part of a shared, reusable module.
- Keep changes minimal and consistent with existing architectural patterns.
```

## Required Review Prompt (Use Before Merging)

```
Review this diff for AI‑style slop and architectural drift.
1) Identify any repeated helper logic or boilerplate that should be shared.
2) Check for missing module dependencies or runtime boundary violations.
3) Flag any ad‑hoc patterns that diverge from existing conventions.
4) Point out any normalization/helper functions that duplicate existing behavior.
5) Recommend reductions, consolidations, or reuse of existing modules.
```

## Human Review Checklist (Must Pass)

- I can point to an existing pattern that this change follows.
- No repeated helpers were created; existing helpers were reused.
- Module dependencies are explicit and correct.
- No new monoliths or large “god” services were introduced.
- The change is minimal and local to the intended package.

If any item fails, the change should be revised before merge.
