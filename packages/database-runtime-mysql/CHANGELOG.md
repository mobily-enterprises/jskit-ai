# Changelog

## Unreleased

- The MySQL application pattern grants the application account `TEST_DB_NAME`'s 26 lettered copies, `<name>_a` to `_z`, which a package's own data test claims (`createPackageTestKnex`).
- The MySQL application pattern names `STAGING_DB_NAME` and `PRODUCTION_DB_NAME` among the databases the test runs refuse, in place of `PROD_DB_NAME`, and calls its prepare script the entrypoint for managed sessions and for staging and production servers.
- **Breaking.** `introspectCrudTableSnapshot` is removed from `./shared` and from the MySQL driver capability (`runtime.database.driver`), which now holds only `DIALECT_ID`: nothing used it since CRUD generation was removed. A table's foreign keys come from `listForeignKeys` in `@jskit-ai/database-runtime/server/foreignKeyMigrations`.
