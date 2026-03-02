# Package Runtime Layout Contract

Status: Stage 0 baseline policy

This contract defines the required runtime filesystem and import/export boundaries for JSKIT framework packages.

## Required package runtime directories

Each framework package must expose these runtime namespaces:

- `src/shared/**`
- `src/client/**`
- `src/server/**`

A package may have empty runtime namespaces during migration, but all three namespace roots must exist in final state.

## Runtime ownership rules

- `shared` is runtime-agnostic code only.
- `client` is browser/runtime UI/client code only.
- `server` is Node/Fastify/DB/runtime code only.

## Import boundary rules

- `src/shared/**` must not import:
  - `node:*`
  - Fastify/Knex server libraries
  - Vue/UI rendering libraries
  - browser globals
- `src/client/**` must not import `src/server/**`.
- `src/server/**` must not import `src/client/**`.

## Export map requirements

Each package export map must include runtime subpath namespaces:

- `./shared/*`
- `./client/*`
- `./server/*`

During migration, package root exports may continue to work, but runtime subpath exports are mandatory.

## No-legacy completion rule

After Stage 12:

- Legacy non-runtime paths must be removed from package internals.
- Compatibility re-export shims must be removed.
- CI must fail on legacy internal path usage.
