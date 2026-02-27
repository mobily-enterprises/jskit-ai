# @jskit-ai/jskit-knex

Database utility facade for JSKIT feature modules.

Feature/domain packages should depend on this package for:

- database UTC timestamp normalization
- duplicate entry detection across supported SQL dialects
- retention helpers for batched cleanup
- JSON-field predicate helpers with dialect-aware SQL generation

Feature/domain packages must not import dialect packages directly.
