# Chat And Transcript Storage Migration

## Extracted Packages

- `@jskit-ai/chat-knex-mysql`
- `@jskit-ai/assistant-transcripts-knex-mysql`

## App Wiring Pattern

- App repository modules are wrappers that bind `db` and re-export package repositories.
- Runtime repository registry composes package constructors.

## Extension Points For New Apps

- Keep schema-specific data access in `*-knex-mysql` adapters.
- Keep domain logic in core/service packages; do not duplicate repository SQL in apps.
