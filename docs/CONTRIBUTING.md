# Docs Contribution Guide

This repository treats manual chapters and `docs/examples/*` as one system.

## Rules

- Every manual chapter must reference at least one runnable example package in `docs/examples`.
- Keep chapter snippets aligned with the referenced source files.
- If you change an example, update the matching chapter snippet in the same commit.

## Required workflow

1. Create or update example code under `docs/examples/*`.
2. Reference the example package path in the matching manual chapter.
3. Update chapter snippets manually from the source of truth files.
4. Validate docs output:
   - `npm run docs:build`
   - or `npm run docs:dev` while iterating.

## Notes

- Automated snippet sync/verify scripts are not currently part of this repository.
- Some older chapter files may still contain legacy snippet marker comments; treat them as documentation markers, not executable tooling contracts.
