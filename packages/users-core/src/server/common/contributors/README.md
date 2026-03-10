# `contributors/`

Use this directory for server runtime contributors shared by more than one feature slice.

What belongs here:
- action context contributors
- other server-side contributor objects that enrich runtime behavior across slices

Examples:
- a workspace action context contributor used by `workspaceSettings`, `workspaceMembers`, and other workspace slices

Do not put these here:
- feature actions
- feature services
- repositories
- route handlers
- one-off helpers for a single slice

Rule:
- if the contributor exists only for one feature, keep it inside that feature folder
- if multiple feature folders need the same contributor, move it here
