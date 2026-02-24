# Auth Migration

## Extracted Packages

- `@jskit-ai/auth-provider-supabase-core`
- `@jskit-ai/auth-fastify-adapter`

## App Wiring Pattern

- Runtime service wiring constructs auth service from provider config.
- Transport layer (`controller/routes/schema`) is package-owned and app-wrapped.

## Extension Points For New Apps

- Keep provider-specific logic inside provider-core packages.
- Add new provider packages behind the same service contract instead of duplicating auth module code.
