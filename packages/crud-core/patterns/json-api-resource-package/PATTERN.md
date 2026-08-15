---
id: crud/json-api-resource-package
title: JSON API CRUD resource package
summary: Build a complete application-owned CRUD server package from a migration, resource contract, and one framework module declaration.
keywords: actions, crud, database, json-api, migration, permissions, provider, repository, routes, service
requires: @jskit-ai/crud-core, @jskit-ai/resource-crud-core
---

# JSON API CRUD resource package

## Use when

Use this pattern when a product entity needs conventional JSON API list, view,
create, patch, and delete behavior. JSKIT owns the repeated repository, service,
action, route, and provider mechanics. The application owns the migration,
resource contract, access surface, ownership policy, and package composition.

## Do not use when

Do not use this pattern for a command-oriented workflow, aggregate, import job,
multi-resource transaction, or domain with materially different operations.
Use a feature package and explicit services for those cases.

## Product decisions

Decide the entity fields, validation, search, sorting, access surface, ownership,
enabled operations, route name, permissions, and user-facing messages. Author
those decisions in normal migration and resource source. Do not derive them
from a generator questionnaire or treat a live table as the sole contract.

## Invariants

- Migration and resource storage metadata describe the same table.
- `apiAccess`, surface access, and `autofilter` agree.
- Public routes use public ownership only.
- Workspace routes receive explicit scope validators and route-to-action input.
- Application source contains one module declaration, not copied generic CRUD
  repository, service, action, route, and provider files.
- Current migration/resource/source state is authoritative; there is no receipt,
  provenance marker, generator identity, or field-patching lane.

## Framework APIs

Use `defineCrudResource()` from `@jskit-ai/resource-crud-core` and
`defineCrudJsonApiFeature()` from `@jskit-ai/crud-core`. The latter composes the
JSON REST resource, repository, service events, standard CRUD actions, route
contracts, access policy, and HTTP routes.

## Example files

`example/` contains a complete books package plus a source-controlled migration.
`BooksFeature.js` is deliberately tiny: it binds the readable resource contract
to the framework module and exports the resulting provider.

## Variation points

Change the package name, resource fields, table, surface, ownership filter,
relative route, messages, and migration. Supply explicit permissions when the
surface uses named policy. For workspace ownership, add the workspace route and
action validators through the module's `scope` option. Move to an explicit
feature service when operations stop being conventional CRUD.

## Verification

- Rebuild the table from migrations in disposable MySQL and PostgreSQL databases
  when both drivers are supported by the application.
- Validate representative accepted and rejected resource values.
- Exercise every enabled route and JSON API document shape.
- Prove positive owner access and negative cross-owner access.
- Verify public routes require neither identity nor CSRF only when explicitly
  declared public.
- Run the package tests and application verifier.

## Avoid

- copied generic repository/service/action/route/provider boilerplate
- generator subcommands for adding fields
- editing an applied baseline migration instead of adding a new migration
- public access combined with user or workspace ownership
- implicit workspace route parameters or permissions
- receipt, replay, provenance, ownership-marker, or scaffold-shape files
