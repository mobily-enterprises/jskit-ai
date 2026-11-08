# Changelog

## Unreleased

- **Breaking.** `introspectCrudTableSnapshot` is removed from `./shared` and from the MySQL driver capability (`runtime.database.driver`), which now holds only `DIALECT_ID`: nothing used it since CRUD generation was removed. A table's foreign keys come from `listForeignKeys` in `@jskit-ai/database-runtime/server/foreignKeyMigrations`.
