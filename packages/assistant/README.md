# @jskit-ai/assistant

Install assistant runtime/config for one surface, then scaffold assistant pages at explicit page files.

## Mental Model

`@jskit-ai/assistant` is the generator package.

- `setup` installs the assistant runtime/config/env wiring.
- `page <target-file>` creates the assistant runtime page anywhere relative to `src/pages/...`.
- `settings-page <target-file>` creates the assistant settings page anywhere relative to `src/pages/...`.

There is no separate server command and no separate client command.

The layering is:

- `@jskit-ai/assistant`: generator package with `setup`, `page`, and `settings-page`
- `@jskit-ai/assistant-runtime`: runtime package installed by `setup`
- `@jskit-ai/assistant-core`: lower-level provider/client library pulled in by `assistant-runtime`

So the normal flow is:

- run `setup`
- optionally create `page`
- optionally create `settings-page`

Page placement follows the same file-driven model as `@jskit-ai/ui-generator`.

- The surface comes from where the page file lives.
- The route URL comes from that file path.
- The default page-link placement comes from the nearest real parent subpages host when there is one.

Only one assistant can be installed per target surface. That rule is enforced by `setup`, which writes the per-surface config entries.

## Setup

```bash
npx jskit generate @jskit-ai/assistant setup \
  --surface admin \
  --settings-surface console \
  --config-scope global \
  --ai-provider openai \
  --ai-api-key "$OPENAI_API_KEY" \
  --ai-base-url "" \
  --ai-timeout-ms 120000
```

`setup` does not create pages.

It only registers:

- `config.assistantSurfaces.<surface>`
- `config.assistantServer.<surface>`
- prefixed AI env defaults in `.env`
- the `@jskit-ai/assistant-runtime` dependency chain, including `@jskit-ai/assistant-core`

## Runtime Page

```bash
npx jskit generate @jskit-ai/assistant page \
  admin/ops/copilot/index.vue
```

The page surface id comes from the target file path.

Optional page-link overrides:

- `--name`
- `--link-placement`
- `--link-component-token`
- `--link-to`

## Settings Page

```bash
npx jskit generate @jskit-ai/assistant settings-page \
  admin/settings/index/assistant/index.vue \
  --surface admin
```

For `settings-page`, the page location and the assistant target surface are separate concerns:

- `<target-file>` decides where the settings page lives and how its page link is placed
- `--surface` decides which assistant surface the settings page edits

The same optional page-link overrides are supported:

- `--name`
- `--link-placement`
- `--link-component-token`
- `--link-to`
