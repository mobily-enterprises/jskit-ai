# `account/common/`

Shared server code for the `account*` slices only.

Use this folder when code is reused by more than one account slice:
- `accountProfile`
- `accountSecurity`
- `accountPreferences`
- `accountNotifications`
- `accountChat`

Do not put workspace/console cross-domain code here.
If code is reused across domains, move it to `server/common/`.
