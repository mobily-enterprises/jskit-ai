Create a durable JSKIT app blueprint from this app brief.

App brief:

{{app_brief}}

Produce a concise but useful app-level blueprint. It must describe product intent, platform choices, and architectural boundaries. It must not become an implementation task list for one issue.

Before writing the blueprint, classify the app state if local files are available:

- empty
- non_jskit_repo
- partial_jskit_app
- jskit_app

Recognize these files as signs of a real JSKIT app when they exist:

- package.json
- config/public.js
- src/main.js
- packages/main/package.descriptor.mjs
- .jskit/lock.json

If the app is empty or only a fresh minimal scaffold, keep platform choices explicit and provisional until decided. Do not treat a missing `config.tenancyMode` line or untouched minimal scaffold as a final tenancy decision.

Cover:

- App purpose and what the app will do in general.
- Primary users and actors.
- Type of multihoming or tenancy: none, personal, workspaces, or another explicit model from the brief.
- Database engine, if the app needs persistence.
- Auth provider, if the app needs auth.
- The role of each surface: app, admin, console, settings, public, workspace, or any app-specific surface from the brief.
- Global view of the main product areas and navigation destinations.
- Key domain concepts and data objects, without inventing database schemas unless the brief clearly requires them.
- Ownership model per persistent entity when it is already clear: public, user, workspace, or workspace_user.
- Baseline JSKIT package workflows to accept as defaults and any intended overrides.
- Package install, generator, and custom-code areas at a high level.
- CRUDs likely to need server ownership, and any narrow exceptions that should be called out later.
- Important non-goals and constraints.
- First useful screen and what it should show.
- Settings, admin, and operator expectations when relevant.
- Verification expectations, including UI checks for user-facing screens.

If the brief is ambiguous, state the assumption in the blueprint instead of asking questions. Do not invent detailed feature behavior that the brief does not support.

When the blueprint is ready, present the final Markdown starting with `# App Blueprint`.
