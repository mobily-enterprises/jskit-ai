Create a durable JSKIT app blueprint from this app brief.

App brief:

{{app_brief}}

Produce a concise but useful app-level blueprint. It must describe product intent, not implementation steps for the current issue.

Cover:

- App purpose and what the app will do in general.
- Primary users and actors.
- Type of multihoming or tenancy: none, personal, workspaces, or another explicit model from the brief.
- The role of each surface: app, admin, console, settings, public, workspace, or any app-specific surface from the brief.
- Global view of the main product areas and navigation destinations.
- Key domain concepts and data objects, without inventing database schemas unless the brief clearly requires them.
- Important non-goals and constraints.
- First useful screen and what it should show.
- Settings, admin, and operator expectations when relevant.

If the brief is ambiguous, state the assumption in the blueprint instead of asking questions.

When the blueprint is ready, output only the final markdown surrounded by these exact markers:

[app_blueprint]
# App Blueprint
...
[/app_blueprint]
