# @jskit-ai/database-knex-core

Knex-oriented persistence primitives for JSKIT provider runtime.

## What this package does

- Encapsulates transaction management in `TransactionManager`.
- Provides `BaseRepository` helpers for transaction usage and pagination metadata.
- Binds Knex + transaction manager into application container tokens.
