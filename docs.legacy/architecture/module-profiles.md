# Module Profiles

Phase 7 adds explicit profile contracts for server/client module composition.

## Default Profile

- Profile ID: `web-saas-default`
- Source: `shared/framework/profile.js`

This profile declares:

- required server modules (`auth`, `workspace`, `console`, `health`, `actionRuntime`, `observability`)
- optional server modules (feature modules)
- required/optional client modules

## Required Module Enforcement

Server composition now supports required profile enforcement through:

- `profileId`
- `enforceProfileRequired`

In server bootstrap, required profile enforcement is enabled.
Startup fails when a required profile module is missing from selection or registry.

## Optional Module Packs

The profile defines optional packs for targeted composition (examples):

- `+social`
- `+billing`
- `+ai`
- `+collaboration`
- `+calculator`
- `+security`
- `+core` (required modules only)

Pack selection is available through framework composition options and `framework:deps:check`.

Extension modules loaded through the Phase 8 extension loader are allowed by profile by default.
They still participate in the same dependency/capability validation and can be disabled by explicit module selection or permissive diagnostics.

## Verification Commands

```bash
npm run framework:deps:check
npm run framework:deps:check -- --packs +social
npm run framework:profiles:test
```
