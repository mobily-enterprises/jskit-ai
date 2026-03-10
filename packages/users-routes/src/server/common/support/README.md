# `support/`

Use this directory for small route-side helpers shared by more than one route slice.

What belongs here:
- tiny route registration helpers
- shared request-shaping helpers used by several route builders
- route-only utilities that do not belong to one feature

Examples:
- a helper for repeated route response construction
- a helper for repeated route parameter shaping

Do not put these here:
- feature route builders
- controllers
- actions
- services
- repositories

Rule:
- if a helper is only used by one route slice, keep it inside that slice
- if it affects general route behavior, consider whether it belongs in `kernel` instead
