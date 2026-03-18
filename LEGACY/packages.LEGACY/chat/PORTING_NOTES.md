# Chat Module Porting Notes

Purpose: avoid blind porting of chat settings into `users-core`.

## Ownership Model (Legacy Source of Truth)

- Chat settings are **module-owned**, not `users-core`-owned.
- Persistence lives in table `chat_user_settings`, not `user_settings`.
- Reference migration:
  - `LEGACY/app.LEGACY/jskit-value-app/migrations/baseline-steps/20260222190000_create_chat_user_settings_and_blocks.cjs`

## Chat Settings Data Contract

From legacy migration/repository, the chat settings shape is:

- `publicChatId` <-> `public_chat_id` (nullable, unique, lowercase-normalized)
- `allowWorkspaceDms` <-> `allow_workspace_dms` (boolean, default `true`)
- `allowGlobalDms` <-> `allow_global_dms` (boolean, default `false`)
- `requireSharedWorkspaceForGlobalDm` <-> `require_shared_workspace_for_global_dm` (boolean, default `true`)
- `discoverableByPublicChatId` <-> `discoverable_by_public_chat_id` (boolean, default `false`)

References:

- `LEGACY/packages.LEGACY/chat/chat-core/src/server/repositories/userSettings.repository.js`
- `LEGACY/packages.LEGACY/workspace/settings-fastify-routes/src/server/lib/schema.js`

## API and Action Contract (Legacy)

- Route: `PATCH /api/settings/chat`
- Action id: `settings.chat.update`
- Payload keys are exactly the 5 fields above.

References:

- `LEGACY/accountChat/bootAccountChatRoutes.js`
- `LEGACY/accountChat/accountChatActions.js`
- `LEGACY/packages.LEGACY/workspace/settings-fastify-routes/src/server/lib/routes.js`

## Porting Rules for Current System

1. Do not re-add chat fields to `users-core` `user_settings`.
2. Chat module owns its own migration(s), repository, validators, and settings form.
3. If chat exposes account settings UI, it should be a module-owned settings element plugged via placements.
4. `users-core` remains chat-agnostic until chat module is installed/ported.
