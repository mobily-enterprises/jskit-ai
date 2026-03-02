# Realtime Coverage Matrix

Last updated: 2026-02-25 (UTC)

Legend:
- `Synced`: mutation publishes realtime and clients invalidate/refresh deterministically.
- `Partial`: some paths/surfaces sync, others rely on polling/local broadcast.
- `Missing`: no realtime publish + strategy contract yet.

| Domain / Mutation path | Status | Notes |
| --- | --- | --- |
| Projects create/update (`projects.create`, `projects.update`) | Synced | Publish now occurs in action contributor for `api`, `assistant_tool`, and `internal` channels. |
| Workspace admin settings/members/invites | Synced | Workspace topic events + workspace admin invalidation strategy. |
| Chat messages/read/typing/attachments | Synced | Workspace-targeted fanout now re-checks auth and requires workspace topic subscription. |
| Alerts create (`user.alert.created`) | Synced | User-scoped targeted alerts + explicit alerts event-handler strategy. |
| Alerts mark-all-read | Partial | Same-browser tabs sync immediately via local broadcast; cross-session relies on fetch refresh cadence. |
| Assistant transcript list updates | Partial | Transcript topic invalidates transcript query family; live stream remains local-tab runtime. |
| Settings/profile/security mutations | Synced | `settings` user-scoped topic + action-layer publish + `["settings"]` invalidation strategy. |
| DEG2RAD/history writes | Synced | `history` user-scoped topic + `deg2rad.calculate` publish + history query invalidation. |
| Console settings writes (`console.settings.update`) | Synced | `console_settings` user-scoped topic + console-settings query invalidation. |
| Console members/invites/billing/errors writes | Synced | User-scoped console topics publish from command actions + console query-family invalidation strategies. |

## Correlation guardrail (write routes)

Event-producing writes must carry:
- `x-command-id`
- `x-client-id`

Current correlated write route coverage includes:
- workspace project writes
- workspace admin writes (settings/member role/invites)
- workspace invitation redeem
- chat write routes (messages/attachments/read/typing/reactions)
