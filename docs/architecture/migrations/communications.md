# Communications Migration

## Extracted Packages

- `@jskit-ai/communications-contracts`
- `@jskit-ai/communications-provider-core`
- `@jskit-ai/communications-core`
- `@jskit-ai/communications-fastify-adapter`
- `@jskit-ai/email-core`
- `@jskit-ai/sms-core` (orchestration-integrated)

## App Wiring Pattern

- Keep app wiring thin in `server/runtime/services.js`:
  - construct `smsService`
  - construct `emailService`
  - compose `communicationsService`
- Keep transport layer thin in `server/modules/communications/*` as package wrappers.

## Extension Points For New Apps

- Use `createService({ smsService, emailService, providers })` from `communications-core`.
- Add custom channel providers via `communications-provider-core` contracts.
- Reuse `communications-fastify-adapter` for HTTP route/controller wiring.
