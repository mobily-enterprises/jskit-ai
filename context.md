# JSKIT Full Working Context Dump

Last updated: 2026-03-02 (session snapshot)

This file is intentionally verbose. It is meant to be a complete handoff memory for ongoing migration/debug work.

---

## 0) Executive Summary

You are migrating JSKIT to a strict, opinionated Laravel-style module architecture with these priorities:

1. Minimal app-owned copied code.
2. Package-owned implementation for upgradeability.
3. Strict, explicit module boundaries (`server`, `client`, `lib`).
4. No compatibility shims/fallbacks long-term.
5. Practical workflow: stabilize a small pilot slice first (auth) and verify in real app (`manual-app`) before scaling.

Current reality:

- Auth slice is partially migrated and mostly aligned.
- `auth-web` wrappers were improved (login and signout scaffolds are now thin).
- `manual-app` now has baseline server health endpoint (`/api/health`) and basic FS routing setup.
- Auth install is currently blocked because two required packages were missing from active `packages/` (`http-client-runtime`, `http-contracts`) and were being resolved from npm registry.
- Those two packages have now been copied from legacy into active packages but still require normalization/pass and integration verification.

---

## 1) Non-Negotiable User Requirements (must remain in force)

### 1.1 Architectural rules

1. Full Laravel-style module shape.
2. Strict module folders: only `src/server`, `src/client`, `src/lib`.
3. `src/server/index.js` and `src/client/index.js` as explicit entrypoints.
4. `src/lib` must be pure shared logic (no Node-only APIs when intended shared).
5. No root aggregator compatibility exports in final architecture.
6. No old contribution runtime model/shims long-term.

### 1.2 Packaging and imports

1. Explicit subpath imports preferred (`/server`, `/client`, explicit paths).
2. Avoid bare root ambiguity.
3. Installable modules should look like modules (provider-driven runtime registration).
4. Keep app-installed scaffold files tiny.

### 1.3 UX and reliability

1. Avoid magic where explicit code is cleaner.
2. Reduce duplicate code between template scaffolds and package implementations.
3. Generated app should work immediately with routing + a visible success page.
4. Add auth on top of a stable baseline.

### 1.4 Process constraints from user

1. Discussion-only means discussion-only.
2. Ask before risky/undesired edits when requested.
3. Prefer real debugging via running commands over speculation.
4. Keep momentum; avoid long detours.

---

## 2) Session Decisions Already Made

### 2.1 `auth-web` component ownership model

Decision: package keeps real auth UI logic; scaffolded app files are wrappers.

- Good: app has minimal code and receives package updates automatically.
- Bad old state: duplicated full UI in both package and scaffold template.

### 2.2 Wrapper style preference

- User rejected dynamic `<component :is="...">` for signout wrapper.
- User wants explicit component in scaffold template.

Result implemented for signout scaffold:

```vue
<script setup>
import DefaultSignOutView from "@jskit-ai/auth-web/client/views/DefaultSignOutView";
</script>

<template>
  <DefaultSignOutView />
</template>
```

### 2.3 Package view path normalization

Decision: flat package views are clearer than mixed `views/login` and `views/auth`.

Current package-level path shape in `auth-web`:

- `src/client/views/DefaultLoginView.vue`
- `src/client/views/DefaultSignOutView.vue`

Template destination can still stay route-folder-oriented in app (e.g. `src/views/login/LoginView.vue`, `src/views/auth/SignOutView.vue`).

### 2.4 Baseline health route in template and manual-app

Decision: base server should own `/api/health` to support immediate app sanity checks.

Added route:

```js
app.get("/api/health", async () => ({ ok: true, app: "..." }));
```

Applied to:

- `/home/merc/Development/current/manual-app/server.js`
- `/home/merc/Development/current/jskit-ai/tooling/create-app/templates/base-shell/server.js`

---

## 3) Important Files Touched (confirmed)

### 3.1 `auth-web` package (active repo)

1. `packages/auth-web/templates/src/views/auth/SignOutView.vue`
   - Changed from full implementation to thin wrapper.
2. `packages/auth-web/templates/src/views/login/LoginView.vue`
   - Imports updated to new flat package view path.
3. `packages/auth-web/src/client/views/...`
   - Moved to flat:
     - `DefaultLoginView.vue`
     - `DefaultSignOutView.vue`
4. `packages/auth-web/src/client/index.js`
   - Exports updated to flat view files.
5. `packages/auth-web/src/client/providers/AuthWebClientProvider.js`
   - Login component import path updated.
6. `packages/auth-web/package.json`
   - Client subpath exports updated to flat view paths.
7. `packages/auth-web/package.descriptor.mjs`
   - Override default path updated.
   - Signout mutation reason text updated.

### 3.2 base-shell template / manual-app

1. `tooling/create-app/templates/base-shell/server.js`
   - Added `/api/health` route.
2. `/home/merc/Development/current/manual-app/server.js`
   - Added `/api/health` route.

### 3.3 newly copied packages (uncommitted)

1. `packages/http-client-runtime/` (copied from `LEGACY/packages.LEGACY/web/http-client-runtime`)
2. `packages/http-contracts/` (copied from `LEGACY/packages.LEGACY/contracts/http-contracts`)

Current git status in main repo shows only these as untracked:

- `?? packages/http-client-runtime/`
- `?? packages/http-contracts/`

---

## 4) Current Repo Topology Snapshot

Active `packages/` now contains:

- access-core
- auth-provider-supabase-core
- auth-web
- fastify-auth-policy
- http-client-runtime (newly copied)
- http-contracts (newly copied)
- rbac-core

Legacy archive exists under `LEGACY/` and still includes many not-yet-ported packages.

---

## 5) `manual-app` Current State Snapshot

Path: `/home/merc/Development/current/manual-app`

### 5.1 Installed/auth lock state

`.jskit/lock.json` exists and records installed packages:

- `@jskit-ai/access-core`
- `@jskit-ai/rbac-core`
- `@jskit-ai/fastify-auth-policy`
- `@jskit-ai/auth-web`

Auth files were copied into app during partial install:

- `src/views/login/LoginView.vue`
- `src/views/auth/SignOutView.vue`
- `src/runtime/authHttpClient.js`
- `src/runtime/authGuardRuntime.js`
- `src/runtime/useSignOut.js`

### 5.2 Current dependency problem in `manual-app/package.json`

It currently contains unresolved semver deps that were expected from npm registry:

- `@jskit-ai/http-client-runtime": "0.1.0"`
- `@jskit-ai/http-contracts": "0.1.0"`

Those are not published, which caused add/install failure.

### 5.3 Additional dependency shape detail

`manual-app` still uses local symlink strategy for `@jskit-ai/jskit` in `postinstall`:

```json
"postinstall": "bash -lc 'rm -rf node_modules/@jskit-ai/jskit; ln -s ../../../jskit-ai node_modules/@jskit-ai/jskit'"
```

---

## 6) Auth Install Failure Root Cause Chain

### Symptom

`npx jskit add bundle auth-base` failed with npm E404 for `@jskit-ai/http-client-runtime@0.1.0`.

### Root cause

1. `auth-web` declares dependency on `@jskit-ai/http-client-runtime` and `@jskit-ai/http-contracts`.
2. Those packages were not in active `packages/` at the time.
3. Resolver wrote semver (`0.1.0`) deps to app, leading npm to registry lookup.
4. Registry package was unavailable, install failed.

### Why this matters

Even though package copy operations and lock updates partially succeeded, app state is now mixed and needs reconciliation.

---

## 7) Clarification: `http-contracts` and why auth-web needs it

`auth-web` server imports from `@jskit-ai/http-contracts/errorResponses`:

- `withStandardErrorResponses`
- `enumSchema`

Used in:

- route response schema assembly
- auth schema enum definitions

So yes, auth-web currently does need `http-contracts` (unless refactored to inline equivalent helpers, which has not been done).

---

## 8) Work-in-Progress / Unfinished Items

### 8.1 Immediately unfinished

1. Normalize newly copied `http-client-runtime` package to strict architecture rules.
2. Normalize newly copied `http-contracts` package to strict architecture rules.
3. Ensure descriptors/exports/import conventions align with current policy (explicit subpaths, no root ambiguity where disallowed).
4. Re-run add/install in `manual-app` with local package resolution working.
5. Verify end-to-end:
   - server starts
   - `/api/health` works
   - `/login` loads
   - signout wrapper resolves

### 8.2 Next after baseline auth works

1. Install supabase provider package non-interactively with required options:
   - `--auth-supabase-url`
   - `--auth-supabase-publishable-key`
   - optional `--app-public-url`
2. Verify login/logout behavior with real provider.

---

## 9) Practical Rules Derived During Session

1. If a scaffolded app file can be tiny wrapper, do that.
2. Real logic should live in package module files.
3. Template default UX should work out-of-the-box but be easy to replace by editing app-owned wrapper.
4. Keep package internal naming consistent and simple.
5. Keep route URL and view folder structure loosely coupled when needed for clarity.

---

## 10) Known Risks / Regression Traps

1. Duplicate routes (`/api/health`) if both baseline and future module register same path.
2. Partial installs can leave lock/package.json mismatch.
3. Legacy-copied packages may violate new strict conventions until explicitly normalized.
4. Descriptor capability metadata still mixes old conceptual model in places; runtime truth should remain provider code.
5. `manual-app` has no git initialized, so backporting requires manual discipline.

---

## 11) State of Testing and Verification

### Verified recently

1. `manual-app` `createServer()` inject test for `/api/health` returned 200 payload.
2. Descriptor parse check for `auth-web/package.descriptor.mjs` succeeded.

### Not fully verified yet

1. Full `manual-app` auth flow after resolving missing runtime packages.
2. Full test matrix after latest package path changes.
3. Supabase provider integration in current app instance.

---

## 12) Command Outcomes Worth Remembering

1. `npx jskit add bundle auth-base` in manual-app:
   - partially applied changes
   - failed at npm install due to missing registry packages.

2. `npx jskit add package @jskit-ai/auth-provider-supabase-core` without options:
   - failed because required options are mandatory in non-interactive mode.

3. Root-level tests for auth-web workspace can fail if dependent local packages are missing.

---

## 13) Recommended Next Execution Plan (concrete)

1. Normalize `packages/http-client-runtime` and `packages/http-contracts` to current strict model.
2. Ensure jskit package discovery sees them from `packages/`.
3. Repair `manual-app` dependency entries (prefer via jskit-managed path, not ad-hoc hacks).
4. Run `npm install` in manual-app.
5. Run:
   - `npm run server`
   - `npm run dev`
6. Validate:
   - `GET /api/health` -> `{ ok: true, app: ... }`
   - `/login` renders package default login view through wrapper
   - signout wrapper imports package default signout view correctly

If all green, proceed to supabase provider install with explicit options.

---

## 14) Minimal “resume me now” checklist

When resuming work immediately:

1. Check `git status` in `jskit-ai` (expect untracked `http-client-runtime` and `http-contracts`).
2. Normalize those two packages.
3. Fix manual-app broken semver refs to local package refs through proper install flow.
4. Run manual-app server+dev and test login page.

---

## 15) Pinned Facts (do not forget)

1. User wants strict architecture, not temporary comfort hacks.
2. User wants tiny copied files and package-owned implementation.
3. User prefers explicit over magic.
4. User asked to ask before certain fixes and dislikes unsolicited broad changes.
5. The immediate priority is a working baseline app, then auth, then scale.

---

## 16) Open Questions Still Not Finalized

1. Final policy for root `.` exports across all packages (strict removal vs transitional throw module).
2. Final shape of capability metadata in fully provider-centric world.
3. Whether `/api/health` remains permanently baseline-owned or delegated to dedicated module package later.
4. Whether login wrapper should also be explicit (no dynamic prop) to mirror signout preference fully.

---

## 17) Quick file references

### Main repo

- `/home/merc/Development/current/jskit-ai/packages/auth-web/package.descriptor.mjs`
- `/home/merc/Development/current/jskit-ai/packages/auth-web/package.json`
- `/home/merc/Development/current/jskit-ai/packages/auth-web/src/client/index.js`
- `/home/merc/Development/current/jskit-ai/packages/auth-web/src/client/views/DefaultLoginView.vue`
- `/home/merc/Development/current/jskit-ai/packages/auth-web/src/client/views/DefaultSignOutView.vue`
- `/home/merc/Development/current/jskit-ai/packages/auth-web/templates/src/views/login/LoginView.vue`
- `/home/merc/Development/current/jskit-ai/packages/auth-web/templates/src/views/auth/SignOutView.vue`
- `/home/merc/Development/current/jskit-ai/tooling/create-app/templates/base-shell/server.js`
- `/home/merc/Development/current/jskit-ai/packages/http-client-runtime/` (new)
- `/home/merc/Development/current/jskit-ai/packages/http-contracts/` (new)

### Manual app

- `/home/merc/Development/current/manual-app/server.js`
- `/home/merc/Development/current/manual-app/package.json`
- `/home/merc/Development/current/manual-app/.jskit/lock.json`
- `/home/merc/Development/current/manual-app/src/views/login/LoginView.vue`
- `/home/merc/Development/current/manual-app/src/views/auth/SignOutView.vue`

---

## 18) Final note

This context file reflects the current migration state as observed in this session. It is intentionally detailed to prevent loss of intent and to keep implementation aligned with your constraints.
