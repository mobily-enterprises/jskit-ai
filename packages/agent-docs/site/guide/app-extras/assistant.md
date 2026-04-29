# Assistant

At the end of the previous chapter, the app could already host live transports, but it still had no assistant surface of its own.

Assistant setup in JSKIT happens in two layers:

- `assistant-runtime`
  - the real runtime package
  - owns the shared tables, routes, client runtime, and config registries
- `assistant`
  - a generator package used through `npx jskit generate assistant ...`
  - scaffolds pages and writes per-surface assistant configuration

That split is the main thing to understand before you start. Installing the runtime does **not** automatically create assistant pages. The generator commands decide which surfaces get assistants and where each assistant is configured.

In this chapter, we set up three assistants with three different roles:

- a `console` assistant configured in `console`
- an `admin` assistant configured from `console`
- an `app` assistant configured from `admin`, with one configuration per workspace

## Recap from previous chapters

To get back to the same starting point as the end of the previous chapter, run:

```bash
SUPABASE_URL=...
SUPABASE_KEY=...
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=exampleapp
DB_USER=exampleapp
DB_PASSWORD=secret

npx @jskit-ai/create-app exampleapp --tenancy-mode personal
cd exampleapp
npm install

npx jskit add package shell-web
npx jskit add package auth-provider-supabase-core \
  --auth-supabase-url "$SUPABASE_URL" \
  --auth-supabase-publishable-key "$SUPABASE_KEY" \
  --app-public-url "http://localhost:5173"
npx jskit add bundle auth-base
npx jskit add package database-runtime-mysql \
  --db-host "$DB_HOST" \
  --db-port "$DB_PORT" \
  --db-name "$DB_NAME" \
  --db-user "$DB_USER" \
  --db-password "$DB_PASSWORD"
npx jskit add package users-web
npx jskit add package console-web
npx jskit add package workspaces-core
npx jskit add package workspaces-web
npx jskit add package realtime
npm install
npm run db:migrate
```

If you are already continuing from the previous chapter, you are already in the right place and can skip that setup.

<DocsTerminalTip label="Important" title="`assistant-runtime` And `assistant` Are Different">
`assistant-runtime` is the package you install into the app with `jskit add package`.

`assistant` is the generator you use afterwards with:

```bash
npx jskit generate assistant ...
```

That means the flow is:

1. install `assistant-runtime`
2. run `npm install`
3. run `npm run db:migrate`
4. use the `assistant` generator to define assistant surfaces and scaffold pages

The runtime package brings the engine. The generator decides how your app exposes that engine.
</DocsTerminalTip>

## Installing `assistant-runtime`

From inside `exampleapp`, run:

```bash
npx jskit add package assistant-runtime
npm install
npm run db:migrate
```

This chapter needs the migration step because `assistant-runtime` installs real schema files for:

- assistant configuration
- assistant transcripts

After this install, the app has the shared runtime pieces, but it still does **not** have any assistant pages. That is the next step.

## Three ideas you need before running the generator

The assistant generator revolves around three separate ideas:

- **runtime surface**
  - where the assistant chat UI actually lives
- **settings surface**
  - where the assistant settings screen lives
- **config scope**
  - whether the assistant settings are shared globally or stored per workspace

Those are not the same thing.

The assistant UI can live on one surface while its settings UI lives somewhere else. That is exactly what we want in this chapter.

Here is the target shape:

| Assistant runtime | Runtime surface | Settings surface | Config scope | Meaning |
| --- | --- | --- | --- | --- |
| Console assistant | `console` | `console` | `global` | One operator assistant for the whole app, configured in the operator surface itself |
| Admin assistant | `admin` | `console` | `global` | Workspace-admin assistant UI, but centrally configured by app operators |
| App assistant | `app` | `admin` | `workspace` | Member-facing assistant, configured per workspace from that workspace's admin settings |

That table is the heart of the chapter.

JSKIT is not forcing every assistant to be configured where it runs. It lets you choose the governance model that fits the surface.

## Registering the three assistant surfaces

Set an AI key in your shell first if you already have one:

```bash
OPENAI_API_KEY=...
```

Then run:

```bash
npx jskit generate assistant setup \
  --surface console \
  --settings-surface console \
  --config-scope global \
  --ai-provider openai \
  --ai-api-key "$OPENAI_API_KEY"

npx jskit generate assistant setup \
  --surface admin \
  --settings-surface console \
  --config-scope global \
  --ai-provider openai \
  --ai-api-key "$OPENAI_API_KEY"

npx jskit generate assistant setup \
  --surface app \
  --settings-surface admin \
  --config-scope workspace \
  --ai-provider openai \
  --ai-api-key "$OPENAI_API_KEY"
```

These commands do **not** create any pages yet. They only register three assistant runtime surfaces and write their config blocks into the app.

You can also leave `--ai-api-key` empty if you want to scaffold everything first and wire the key into `.env` later. The assistant pages will still exist, but the actual AI calls will stay unusable until the key is set.

The important `setup` options are:

- `--surface`
  - the runtime surface that will host the assistant UI
- `--settings-surface`
  - the surface that will host the assistant settings screen
- `--config-scope`
  - `global` or `workspace`
- `--ai-provider`
  - which AI backend family this assistant surface should use
- `--ai-api-key`
  - the API key for that assistant surface
- `--ai-base-url`
  - an optional provider-compatible endpoint override
- `--ai-timeout-ms`
  - the request timeout for that assistant surface
- `--ai-config-prefix`
  - an optional override for the env/config prefix
  - if you omit it, JSKIT derives a prefix such as `CONSOLE_ASSISTANT` or `APP_ASSISTANT`

<DocsTerminalTip label="Important" title="Workspace Scope Needs Workspace Surfaces">
`--config-scope workspace` only works when **both** of these surfaces require a workspace:

- the runtime surface
- the settings surface

That is why the chapter uses:

- `app` configured from `admin` with `workspace`

but keeps:

- `admin` configured from `console` with `global`

`console` is a global surface. It does not carry a workspace slug, so it cannot host a workspace-scoped assistant settings flow.
</DocsTerminalTip>

## How assistant tools actually work

This is the most important conceptual point in the whole assistant stack:

The assistant does **not** automatically get access to "the backend" or to "all permission-guarded actions."

What it really gets is a filtered **tool catalog** built from normal JSKIT actions.

For an action to become an assistant tool, all of these must be true:

- it is registered as a real JSKIT action
- its `channels` include `"automation"`
- it has both an input schema and an output schema
- it is allowed on the current surface
- the current actor is allowed to execute it
- it is not hidden by the assistant surface config

So the assistant is never discovering methods by reflection and it is never seeing the entire service layer. It only sees a deliberate action-backed contract.

### Making an action available to the assistant

The normal pattern is:

1. define a normal JSKIT action
2. put it on the `automation` channel
3. give it real input and output schemas
4. optionally give it a better assistant-facing description

For example:

```js
{
  id: "workspace.members.invite",
  domain: "workspace",
  version: 1,
  kind: "command",
  channels: ["automation"],
  surfaces: ["admin"],
  permission: {
    require: "all",
    permissions: ["workspace.members.invite"]
  },
  input: {
    schema: {
      type: "object",
      properties: {
        email: { type: "string" }
      },
      required: ["email"],
      additionalProperties: false
    }
  },
  output: {
    schema: {
      type: "object",
      properties: {
        ok: { type: "boolean" }
      },
      required: ["ok"],
      additionalProperties: false
    }
  },
  extensions: {
    assistant: {
      description: "Invite a member into the current workspace."
    }
  }
}
```

That does two things at once:

- it stays a normal JSKIT action
- it becomes eligible for assistant exposure

If you leave out `channels: ["automation"]`, the assistant will not see it.

If you leave out the schemas, the assistant will not see it.

So the assistant layer is intentionally strict. It only exposes actions with a stable machine-readable contract.

### Permissions still matter

This is the next crucial point:

The assistant only sees tools that the current actor could execute normally.

So if an action says:

```js
permission: {
  require: "all",
  permissions: ["workspace.members.invite"]
}
```

then a user who does **not** have `workspace.members.invite` does not merely get a later failure dialog. That tool is filtered out of the assistant's available tool list before the request is sent to the model.

That means two users on the same surface can get different assistant capabilities, because their permission sets are different.

This is an important mental model:

- normal action permissions still remain the source of truth
- the assistant is a client of that action system, not a bypass around it

### Surface rules still matter too

Actions can also be restricted to specific surfaces.

If an action only lists:

```js
surfaces: ["admin"]
```

then it can appear in the `admin` assistant but not in the `console` assistant or the `app` assistant.

So tool exposure is filtered by **both**:

- who the user is
- where the assistant is running

That is exactly why this chapter's three-assistant setup is interesting. The three assistants can share some actions but differ on others because they do not all run on the same surface.

### How to hide actions even if they qualify

There is one more layer on top of action metadata.

Per-surface assistant server config can still hide tools intentionally.

The relevant config keys are:

- `barredActionIds`
- `toolSkipActionPrefixes`

For example:

```js
config.assistantServer.admin = {
  aiConfigPrefix: "ADMIN_ASSISTANT",
  barredActionIds: ["workspace.members.remove"],
  toolSkipActionPrefixes: ["workspace.audit."]
};
```

That means:

- `workspace.members.remove` is hidden exactly
- any action whose id starts with `workspace.audit.` is hidden by prefix

This is useful when an action is valid in the app but you still do not want a given assistant surface to use it.

So the full exposure model is:

- action metadata says what *can* be a tool
- permission and surface context say what this user *may* use now
- assistant surface config says what this assistant surface *should still hide*

### How the assistant "knows" what it can do

The assistant runtime does not ask the model to invent tools on the fly.

Instead, for each request it builds the filtered tool set for the current:

- surface
- actor
- permission set
- workspace context

Then it sends two things into the AI request:

- the tool schemas themselves
- a system-prompt summary of the available tool names and contracts

So the model only sees the tools that survived all of the filtering above.

If a tool is unavailable:

- it is not described in the prompt
- it is not included in the tool schema payload

And even after that, actual execution still goes through the normal JSKIT action executor under the `automation` channel. So the assistant is constrained twice:

- first by tool-catalog filtering
- then by real action execution

### Workspace context is handled for you

Workspace-scoped tools get one more convenience.

If the current assistant is already running inside a workspace route, the tool catalog can hide the `workspaceSlug` field from the visible tool schema and inject it from the current request context during execution.

That means a workspace assistant can expose simpler tools to the model:

- "invite a member into the current workspace"

instead of always forcing the tool contract to say:

- "invite a member, and also provide the workspace slug again"

That makes the assistant contracts cleaner without weakening the actual workspace boundary.

## Generating the assistant pages

Now create the three runtime pages:

```bash
npx jskit generate assistant page console/assistant/index.vue

npx jskit generate assistant page \
  w/[workspaceSlug]/admin/assistant/index.vue \
  --name "Assistant"

npx jskit generate assistant page \
  w/[workspaceSlug]/assistant/index.vue \
  --name "Assistant"
```

These commands use the page path to decide where the assistant should live.

That gives you:

- `/console/assistant`
- `/w/[workspaceSlug]/admin/assistant`
- `/w/[workspaceSlug]/assistant`

Each generated file is intentionally thin. For example:

```vue
<template>
  <AssistantSurfaceClientElement surface-id="console" />
</template>

<script setup>
import { AssistantSurfaceClientElement } from "@jskit-ai/assistant-runtime/client";
</script>
```

That is a good JSKIT pattern to notice:

- the app owns the route file
- the route file says which assistant surface it is exposing
- the reusable runtime element owns the heavy client behavior

The page generator also adds shell menu placements for those new routes, so the surfaces get real navigation entries without you hand-editing the menus.

In the `page` subcommand:

- the target file path decides the route location
- `--name` changes the generated menu label
- `--link-placement`, `--link-component-token`, and `--link-to` are optional overrides if you want to place the route link somewhere other than the generator's normal inferred target

## Generating the assistant settings pages

Now create the three settings pages:

```bash
npx jskit generate assistant settings-page \
  console/settings/assistant/index.vue \
  --surface console \
  --link-placement console-settings:primary-menu \
  --link-component-token local.main.ui.surface-aware-menu-link-item

npx jskit generate assistant settings-page \
  console/settings/admin-assistant/index.vue \
  --surface admin \
  --name "Admin Assistant" \
  --link-placement console-settings:primary-menu \
  --link-component-token local.main.ui.surface-aware-menu-link-item

npx jskit generate assistant settings-page \
  w/[workspaceSlug]/admin/workspace/settings/app-assistant/index.vue \
  --surface app \
  --name "App Assistant" \
  --link-placement admin-settings:primary-menu \
  --link-component-token local.main.ui.surface-aware-menu-link-item
```

This is the part that often trips people up, so read the rule carefully:

- the **target file path** decides where the settings page lives
- `--surface` decides **which assistant runtime surface that page configures**

So:

- `/console/settings/admin-assistant` configures the `admin` assistant
- `/w/[workspaceSlug]/admin/workspace/settings/app-assistant` configures the `app` assistant

That is not contradictory. It is the whole point of the design.

The generated settings pages are also thin wrappers:

```vue
<template>
  <AssistantSettingsClientElement target-surface-id="app" />
</template>

<script setup>
import { AssistantSettingsClientElement } from "@jskit-ai/assistant-runtime/client";
</script>
```

The file path decides where the settings screen is opened. `target-surface-id` decides which assistant it edits.

The extra link options matter here too:

- `--link-placement`
  - which settings menu outlet should receive the generated link
- `--link-component-token`
  - which link component token should render that menu entry
- `--name`
  - the label shown for the settings entry

That is why the chapter uses:

- `console-settings:primary-menu` for the two console-owned settings screens
- `admin-settings:primary-menu` for the workspace-admin-owned settings screen

## What to look at in the browser

Start both processes again:

```bash
npm run dev
npm run server
```

After sign-in, the app should now expose these assistant routes:

- `/console/assistant`
- `/w/your-personal-slug/admin/assistant`
- `/w/your-personal-slug/assistant`

And these settings routes:

- `/console/settings/assistant`
- `/console/settings/admin-assistant`
- `/w/your-personal-slug/admin/workspace/settings/app-assistant`

The most important thing to verify in the browser is the *relationship* between those pages.

- The `console` assistant runs in `console` and is configured in `console`.
- The `admin` assistant runs in the workspace `admin` surface, but its settings live in `console`, because this chapter treats it as centrally governed.
- The `app` assistant runs in the workspace `app` surface, and its settings live in workspace `admin`, because this chapter treats it as a workspace-owned assistant.

That gives the app two different governance models at the same time:

- app-wide operator-owned assistant config
- per-workspace assistant config

If you left the AI key empty, the pages and settings screens will still exist, but the assistant itself will not become useful until the AI key is filled into `.env`.

## What `assistant-runtime` and `assistant` add to the app

This chapter changes more files than the realtime chapter, but the changes are still easy to read if you keep the runtime/generator split in mind.

### `config/public.js` maps assistant runtime surfaces

After the three `setup` commands, `config/public.js` contains:

```js
config.assistantSurfaces.console = {
  settingsSurfaceId: "console",
  configScope: "global"
};

config.assistantSurfaces.admin = {
  settingsSurfaceId: "console",
  configScope: "global"
};

config.assistantSurfaces.app = {
  settingsSurfaceId: "admin",
  configScope: "workspace"
};
```

This is the public routing contract for assistants.

For each assistant runtime surface, it answers:

- where is this assistant configured?
- is that configuration global or workspace-specific?

### `config/server.js` chooses the env/config prefix for each assistant

The same `setup` commands also write:

```js
config.assistantServer.console = {
  aiConfigPrefix: "CONSOLE_ASSISTANT"
};

config.assistantServer.admin = {
  aiConfigPrefix: "ADMIN_ASSISTANT"
};

config.assistantServer.app = {
  aiConfigPrefix: "APP_ASSISTANT"
};
```

That is what lets one app host several assistants at once without their AI settings colliding.

### `.env` gains one AI block per assistant surface

The app now gets env keys such as:

```dotenv
CONSOLE_ASSISTANT_AI_PROVIDER=openai
CONSOLE_ASSISTANT_AI_API_KEY=
CONSOLE_ASSISTANT_AI_BASE_URL=
CONSOLE_ASSISTANT_AI_TIMEOUT_MS=120000

ADMIN_ASSISTANT_AI_PROVIDER=openai
ADMIN_ASSISTANT_AI_API_KEY=
ADMIN_ASSISTANT_AI_BASE_URL=
ADMIN_ASSISTANT_AI_TIMEOUT_MS=120000

APP_ASSISTANT_AI_PROVIDER=openai
APP_ASSISTANT_AI_API_KEY=
APP_ASSISTANT_AI_BASE_URL=
APP_ASSISTANT_AI_TIMEOUT_MS=120000
```

That is why `setup` is a per-surface command. Each assistant runtime surface gets its own AI configuration namespace.

### `migrations/` gains assistant schema files

Installing `assistant-runtime` also adds schema files for:

- assistant configuration
- assistant transcripts

Those are shared runtime tables. The generator does not create them. That is the runtime package's job.

### `src/pages/...` gains thin runtime and settings wrappers

After the chapter, the app owns several new route files under `src/pages/...`.

The important point is that they are all small wrappers around reusable client elements:

- runtime pages use `AssistantSurfaceClientElement`
- settings pages use `AssistantSettingsClientElement`

That keeps the app-owned routing explicit without copying the runtime logic into every page file.

### `src/placement.js` grows assistant links in several menus

The page generator and settings-page generator also append placement entries.

That is how the assistant routes show up in:

- the main shell menus for `console`, `admin`, and `app`
- the `console` settings menu
- the workspace `admin` settings menu

So the generator is not only creating route files. It is also wiring those routes into the right existing shell and settings outlets.

## Under the hood

`assistant-runtime` owns the shared assistant engine:

- server routes
- database tables
- client runtime
- config loading for each assistant surface

The `assistant` generator then writes the app-specific shape around that engine:

- which assistant surfaces exist
- where their runtime pages live
- where their settings pages live
- which menu outlets should link to them

The runtime uses the current surface and, when needed, the current workspace route context to resolve the right assistant configuration.

That is also why impossible combinations are rejected early. If you ask for workspace-scoped settings on a non-workspace surface, JSKIT fails at generation time instead of letting the app drift into a broken setup.

## Summary

This chapter adds a lot of capability without inventing a new monolithic "assistant mode."

- `assistant-runtime` installs the shared assistant engine
- `assistant setup` registers one assistant runtime surface at a time
- `assistant page` decides where each assistant UI lives
- `assistant settings-page` decides where each assistant is configured

By the end of the chapter, the app has:

- one global operator assistant in `console`
- one workspace-admin assistant governed from `console`
- one workspace-facing assistant governed from `admin`

That is a good example of JSKIT's surface model paying off. The assistant is not tied to one hard-coded area of the app. It can live and be governed differently on different surfaces.
