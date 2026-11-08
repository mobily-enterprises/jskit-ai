# Changelog

## Unreleased

- `defineTableResource` checks `foreignKeys`, the table's real database foreign keys in json-rest-api's shape (`{ columns, referencedTableName, referencedColumns?, name?, deleteRule?, updateRule? }`): `columns` name schema fields, `referencedColumns` the other table's columns (required for a key over several columns, `id` otherwise), and any other key is refused. json-rest-api receives it as before; from 3.1.0 it relies on it to skip a visibility query per linked type in a system context, so `jskit test --databases` checks each declaration against the database.
