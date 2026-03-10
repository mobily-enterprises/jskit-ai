# `support/`

Use this directory for small server-only helpers shared by more than one slice when they are not a service, repository, or contributor.

What belongs here:
- small pure helpers
- value mappers
- shared validation helpers used by several server slices
- low-level server utilities

Examples:
- helper functions that are reused by several action files or services

Do not put these here:
- feature workflow logic
- large business logic blocks
- repositories
- full services
- route adapters

Rule:
- if a helper is specific to one feature, keep it in that feature folder
- if a helper grows into real business logic, it probably wants a service instead
