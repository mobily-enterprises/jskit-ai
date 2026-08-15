# Assistant

`@jskit-ai/assistant-runtime` supplies a reusable assistant runtime, client
elements, actions, persistence, and settings behavior. The application decides
where an assistant belongs and composes its pages directly.

```bash
npm install @jskit-ai/assistant-runtime
npm run db:migrate
```

Use the `assistant/assistant-surface` pattern. There is no assistant generator.

## Product decisions

Choose:

- the runtime surface and settings surface;
- global or workspace configuration scope;
- page routes and placement roles;
- provider and model policy;
- whether the assistant begins disabled until credentials exist.

The application records an environment prefix, never an API key, in source.
Secrets arrive through the normal deployment or development environment.

## Composition

Use `AssistantSurfaceClientElement` and
`AssistantSettingsClientElement` from `@jskit-ai/assistant-runtime/client`.
Configure public surface behavior and server settings in ordinary app-owned
config, then register routes and placements like any other feature.

Workspace scope is valid only when both the runtime and its settings surface
are workspace-aware. Requests must retain the selected workspace through the
server action boundary.

## Verification

Run migrations, load assistant and settings pages through normal navigation,
test missing credentials without exposing values, exercise one successful and
one provider-error conversation, and verify global or cross-workspace isolation.

Do not add a second model client beside the runtime, copy its repositories or
routes, infer a surface, store keys in source, or keep generator markers,
questionnaire answers, receipts, or provenance.
