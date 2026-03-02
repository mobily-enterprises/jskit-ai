 Yes. Here is a detailed, no-shims, no-back-compat plan to move to exactly the model you described.

  Locked End State

  1. Feature modules import only @jskit-ai/jskit-knex for DB behavior.
  2. Only DB provider packages know dialect specifics.
  3. No feature package imports mysql, postgres, or dialect helper modules.
  4. One selected provider per app (db-mysql or db-postgres), enforced by capabilities.
  5. Old thin *-knex-mysql / *-fastify-adapter slices are removed where they are not independently needed.

  Target Package Model

  1. @jskit-ai/jskit-knex
  2. @jskit-ai/jskit-knex-mysql
  3. @jskit-ai/jskit-knex-postgres
  4. @jskit-ai/db-mysql (tooling package descriptor, installs and wires mysql provider)
  5. @jskit-ai/db-postgres (tooling package descriptor, installs and wires postgres provider)

  Capability Model

  1. @jskit-ai/jskit-knex provides db.core and requires db-provider.
  2. @jskit-ai/db-mysql provides db-provider and depends on @jskit-ai/jskit-knex-mysql.
  3. @jskit-ai/db-postgres provides db-provider and depends on @jskit-ai/jskit-knex-postgres.
  4. Feature packages require only db.core (or db-provider if you prefer one canonical capability name, but keep it
     consistent globally).

  Descriptor Shape (example)

  // @jskit-ai/jskit-knex
  capabilities: {
    provides: ["db.core"],
    requires: ["db-provider"]
  }

  // @jskit-ai/assistant-transcripts-core
  dependsOn: ["@jskit-ai/jskit-knex", "...domain deps..."],
  capabilities: {
    provides: ["assistant.transcripts.core"],
    requires: ["db.core", "...domain caps..."]
  }

  Implementation Stages

  1. Stage 0: Freeze architecture and naming

  - Lock names: jskit-knex, jskit-knex-mysql, jskit-knex-postgres.
  - Lock rule: no domain package may import @jskit-ai/*mysql* or @jskit-ai/*postgres*.
  - Lock rule: no compatibility packages, no aliases, no deprecated IDs.

  2. Stage 1: Inventory real DB primitive usage

  - Scan all packages currently importing @jskit-ai/knex-mysql-core/* and raw SQL.
  - Build a strict primitive list used by real code now:
      - duplicate-key detection
      - timestamp normalization
      - JSON path predicate helpers
      - retention delete helpers
      - dialect-safe upsert/returning patterns
  - This becomes the required API contract for jskit-knex.

  3. Stage 2: Define the jskit-knex contract

  - Define one stable API surface with only operations feature modules need.
  - Separate API areas:
      - query helpers
      - errors
      - JSON operators
      - retention helpers
      - transaction helpers
  - Ensure all APIs are dialect-neutral at call site.

  4. Stage 3: Build @jskit-ai/jskit-knex core package

  - Implement dialect-agnostic façade.
  - Implement dialect registry/hook loading.
  - Implement runtime guards for missing provider.
  - Add full unit tests for API behavior and error messaging.

  5. Stage 4: Build provider packages

  - @jskit-ai/jskit-knex-mysql implements dialect hooks for MySQL.
  - @jskit-ai/jskit-knex-postgres implements dialect hooks for Postgres.
  - Put all unavoidable SQL differences here only.
  - Add contract tests that run the same behavior suite against both providers.

  6. Stage 5: Rewire db-mysql / db-postgres tooling descriptors

  - Update packages/tooling/jskit/packages/db-mysql/package.descriptor.mjs.
  - Update packages/tooling/jskit/packages/db-postgres/package.descriptor.mjs.
  - Ensure each provider package drops the right runtime deps and wiring files.
  - Ensure only one provider is selected per app.

  7. Stage 6: Refactor feature modules to consume only jskit-knex

  - Start with assistant-transcripts-core as pilot.
  - Remove direct imports of @jskit-ai/knex-mysql-core/*.
  - Replace raw MySQL expressions with jskit-knex helper calls.
  - Keep service APIs unchanged where possible; only data plumbing changes.

  8. Stage 7: Apply same refactor to all hard-merge targets

  - assistant-core
  - assistant-transcripts-core
  - chat-core
  - communications-core
  - observability-core
  - security-audit-core
  - social-core
  - user-profile-core
  - workspace-console-service-core
  - workspace-service-core
  - Ensure each one depends on @jskit-ai/jskit-knex, not dialect packages.

  9. Stage 8: Remove obsolete thin packages completely

  - Delete thin packages that become redundant after merge/refactor.
  - Delete their descriptors, source, tests, docs, and package manifests.
  - Remove all references from bundles and package descriptors.
  - No transitional compatibility package left behind.

  10. Stage 9: Enforce architecture in CI

  - Add lint rule: forbidden imports for dialect packages outside DB provider layer.
  - Add grep-based architecture test for forbidden strings (raw dialect SQL signatures in feature packages).
  - Add descriptor validation test: feature packages cannot dependsOn dialect packages.

  11. Stage 10: Update bundle composition

  - Keep regular bundles provider-agnostic.
  - Provider bundles contain only provider-selection pieces.
  - Ensure assistant-openai and similar bundles do not transitively force mysql/postgres.
  - Keep list bundles curated and list bundles all full, with provider split preserved.

  12. Stage 11: End-to-end verification matrix

  - Fresh app creation from template.
  - Add non-provider bundle first, verify missing capability fails with explicit command guidance.
  - Add db-mysql path and run app.
  - Add db-postgres path and run app.
  - Run jskit doctor, bundle list/show, module startup tests, and representative endpoint tests.

  13. Stage 12: Docs and operator playbook

  - Document provider model in MANUAL.md.
  - Document how feature modules consume DB (always through jskit-knex).
  - Document “how to add a new dialect” with required contract tests.
  - Document architecture invariants and CI checks.

  Conversion Order (recommended)

  1. Pilot: assistant-transcripts-core
  2. Workspace path: workspace-console-service-core, workspace-service-core
  3. Social/chat path: chat-core, social-core, user-profile-core
  4. Security/observability/communications
  5. Final cleanup and deletions

  Definition of Done

  1. Zero imports of dialect packages in feature modules.
  2. Zero old thin storage/adapter package references in descriptors/bundles.
  3. All feature packages depend on @jskit-ai/jskit-knex only for DB.
  4. Provider selection works via db-mysql/db-postgres only.
  5. Full test suite and architecture guards green.

  If you want, next I can turn this into an execution checklist with exact file-by-file edits for Stage 1 through
  Stage 4 only, so we can implement in tight commits.

