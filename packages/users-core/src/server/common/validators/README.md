# `validators/`

Put shared validators here when they are reused by multiple server slices/adapters.

Allowed:
- validator objects (`schema` + `normalize`)
- transport-level reusable validators

Not allowed:
- feature-only validators used by one slice
- business/domain decision logic
