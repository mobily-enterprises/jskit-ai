# Context Handoff Prompt (Monorepo + Package Extraction)

Use this prompt when context gets compacted and you need a new agent/session to continue exactly where this one left off.

## Prompt To Reuse

You are taking over a live migration from a single-app repository to a multi-app monorepo with shared internal npm workspace packages.

Your job is to continue the work without re-deciding fundamentals that are already decided.

### 1) High-level goal

We are building a `project monorepo` that will eventually host around 10-15 SaaS apps.

Main objective:
- Minimize repeated boilerplate across apps.
- Extract only truly generic cross-app code into reusable packages.
- Keep abstractions practical (not "clever"), with clear boundaries and low coupling.
- Make cross-app upgrades possible by updating shared packages.

Critical constraint:
- Shared packages must contain zero app-specific constants/business policy.
- App-specific vocabulary/config remains in each app and is passed into package APIs.

### 2) What has already been done (important chronology)

Migration and extraction work already completed:

1. Existing app was moved from repo root to:
- `apps/jskit-value-app`

2. Root monorepo setup was added:
- Root `package.json` with npm workspaces:
  - `apps/*`
  - `packages/*`
  - `packages/*/*`
- Root `package-lock.json` is now the single lockfile.

3. CI was switched to workspace-aware execution and scoped paths:
- `.github/workflows/ci-jskit-value-app.yml`
- Uses `npm run -w apps/jskit-value-app <script>`.
- Trigger paths include app folder + packages + root lock/workspace files.

4. First extracted shared package:
- `@jskit-ai/surface-routing`
- Path: `packages/surface-routing`
- App now consumes this package (instead of owning duplicated routing primitives).

5. Second extracted shared package:
- `@jskit-ai/realtime-contracts`
- Path: `packages/contracts/realtime-contracts`
- App now re-exports protocol constants from package and uses package topic-catalog functions.

6. Shared scripts package added to eliminate per-app script duplication:
- `@jskit-ai/app-scripts`
- Path: `packages/tooling/app-scripts`
- App scripts in `apps/jskit-value-app/package.json` are now thin wrappers invoking `jskit-app-scripts`.
- App-local config file exists:
  - `apps/jskit-value-app/app.scripts.config.mjs`

7. Package scope decision:
- Use `@jskit-ai/*` namespace (not `@jskit/*`).

Recent commit anchors (for orientation):
- `5a2a5ba extract surface-routing workspace package`
- `4b5f651 chore: mechanical formatting and docs sync`
- `2f427dc chore: add npm workspaces and ci baseline wiring`
- `dbdf7b3 feat: add shared app-scripts tooling and thin app wrappers`
- `7d16560 extract realtime-contracts workspace package`
- `1dc15f3 test: add app-scripts preset and cli coverage`

### 3) Current repository structure (relevant parts)

Top-level:
- `apps/`
- `packages/`
- `docs/`
- root `package.json`
- root `package-lock.json`

Current extracted packages:
- `packages/surface-routing`
- `packages/contracts/realtime-contracts`
- `packages/tooling/app-scripts`

Monorepo planning docs:
- `docs/project-monorepo/initial_writeup.md`
- `docs/project-monorepo/3.surface-routing.md`
- `docs/project-monorepo/4.realtime-contracts.md`
- `docs/project-monorepo/5.rbac-core.md`
- `docs/project-monorepo/6.http-client-runtime.md`
- `docs/project-monorepo/7.billing-provider-core.md`
- `docs/project-monorepo/8.realtime-client-runtime.md`
- `docs/project-monorepo/9.fastify-auth-policy.md`
- `docs/project-monorepo/10.realtime-socketio-server.md`
- `docs/project-monorepo/11.entitlements-core.md`
- `docs/project-monorepo/12.entitlements-knex-mysql.md`
- `docs/project-monorepo/2.config-eslint.md`

### 4) Important behavior decisions that must not regress

1. `.env` behavior per app is mandatory.
- Every app must read its own `.env` when commands run in that app.
- Current `app-scripts` CLI executes tasks with `cwd` = app root, preserving this behavior.

2. No over-abstraction:
- Package APIs should normalize/validate generic inputs.
- App still owns domain vocabulary and domain policy values.

3. Mechanical changes and abstraction changes are split:
- Do relocation/workspace wiring in isolated commits.
- Do package extraction in separate commits.

4. Prefer npm workspaces local linking during development:
- Packages resolve locally from workspace.
- No immediate registry publish required for intra-repo development.

### 5) Current validation status

Latest executed checks:
- `npm run -w apps/jskit-value-app lint` -> passes with warnings only (0 errors, 55 warnings).
- `npm run -w apps/jskit-value-app test` -> passes (571 backend tests).
- `npm run -w apps/jskit-value-app test:client` -> passes (27 files, 190 tests).

Interpretation:
- Baseline is green for tests.
- Lint warnings remain (non-blocking currently).

### 6) Outstanding working tree state

There is an untracked file:
- `packages/contracts/realtime-contracts/README.md`

This README is intended to be full package documentation.
One requested doc refinement is still pending:
- In `createTopicCatalog` docs, show both:
  - a "messy input" snippet, and
  - a clear "normalized output/result" snippet.

### 7) How local package linking works here (for clarity)

Use npm workspaces from repo root:
- `npm install` at root creates workspace links.
- App dependency entries like `"@jskit-ai/realtime-contracts": "0.1.0"` resolve to local workspace package when present.

Run scripts either way:
- From app directory: `npm run test`
- From root targeting workspace: `npm run -w apps/jskit-value-app test`

### 8) What to do next (ordered)

Execute in this order unless user changes priority:

1. Finalize and commit `realtime-contracts` docs:
- Improve README example section to explicit input/output normalization format.
- Commit docs-only change separately.

2. Keep extraction momentum with next package candidate:
- Recommended next: `rbac-core` (or `fastify-auth-policy` depending code shape found in app).
- Keep package generic:
  - core permission primitives in package,
  - app-specific roles/permissions manifest in app.

3. For each new package extraction, follow strict sequence:
- Identify pure generic seam.
- Create package with minimal surface API.
- Move code + add tests in package.
- Replace app internals with thin adapters.
- Run lint/tests.
- Commit extraction independently.

4. Continue CI scaling model for future apps:
- One workflow per app (`ci-<app>.yml`).
- Scope each workflow to its app path + shared packages + root workspace files.

### 9) Rules for future extractions

When deciding whether to extract:
- Extract if logic is reusable across >=2 apps and has stable semantics.
- Do not extract if logic is tightly bound to one app's DB schema/business workflow unless an adapter boundary is clear.

Package design checklist:
- Small API, few entry points.
- Explicit configuration inputs.
- No hidden runtime globals.
- Deterministic normalization.
- Strong tests around invariants.
- README with practical examples.

### 10) Immediate commands to run at start of takeover

From repo root:

```bash
git status --short
git log --oneline -n 12
npm run -w apps/jskit-value-app test
npm run -w apps/jskit-value-app test:client
```

If touching docs only, test rerun can be skipped; if touching runtime code, rerun relevant checks.

### 11) Expected output style from you

When you continue:
- Be explicit about what is already done vs what you are changing now.
- Keep commits scoped and mechanical.
- Do not re-introduce app-specific values into shared packages.
- Prefer maintainable straightforward code over heavy abstraction layers.

End of prompt.
