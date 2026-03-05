# JSKIT Manual: Authentication and Authorization

## Domain Authorization Patterns

Domain authorization rules belong here.

This includes rules such as:

- record ownership checks (who can read/update/delete this specific entity)
- state-transition guards (for example draft -> approved, approved -> archived)
- contextual business permissions (same actor can do X in context A but not in context B)

Placement rule:

- transport-level auth policy (route-level auth/middleware) is handled in HTTP/auth runtime wiring
- domain-level authorization is enforced in actions/services
