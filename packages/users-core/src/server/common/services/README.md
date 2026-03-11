# `services/`

Put shared server services here when they are used by more than one slice.

Allowed:
- cross-slice service logic with clear inputs/outputs
- no HTTP route contract handling

Not allowed:
- feature-only services
- route adapters/controllers
- response schema declarations
