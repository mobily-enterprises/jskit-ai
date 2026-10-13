# Subsystems

## `framework-packages` Framework packages

Owns the published JSKIT libraries, application patterns, package migrations,
browser-facing components, server runtimes, and the human and distributed agent
documentation. Packages expose explicit npm entry points so applications can
compose only the capabilities they need.

### Source
- Directory `packages`

### Program
- `genesis/program/framework/application-runtime.md`
- `genesis/program/framework/data-and-resources.md`
- `genesis/program/framework/identity-and-workspaces.md`
- `genesis/program/framework/assistant-and-integrations.md`
- `genesis/program/framework/web-experiences.md`
- `genesis/program/documentation/guidance.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `developer-tooling` Developer tooling

Owns the package catalogue, package-graph checks, shared lint configuration,
and test helpers used to develop and release the workspace.

### Source
- Directory `tooling`

### Program
- `genesis/program/tooling/catalogue.md`

### Data owned
- Nothing.

### Data used
- Nothing.

## `repository-operations` Repository operations

Owns workspace-level verification, generated-artifact checks, coordinated npm
release preparation and publication, and continuous-integration orchestration.
The more specific package and tooling directories retain ownership of their own
implementation.

### Source
- Directory `.`

### Program
- `genesis/program/operations/repository-lifecycle.md`

### Data owned
- Nothing.

### Data used
- Nothing.
