# `contributors/`

Put shared runtime contributors here (for action context or bootstrap payload composition).

Allowed:
- contributors reused by multiple slices/actions
- contributor logic that delegates domain work to services

Not allowed:
- feature-specific contributors used by one slice only
- direct repository access when a service already owns that domain
