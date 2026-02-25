# Action Map (`apps/jskit-value-app`)

Purpose: map every user-visible capability to a canonical business action contract so assistant actions can mirror UI actions.

Scope: app, admin, and console surfaces in `apps/jskit-value-app`, including shared package UI elements wired by this app.

Date: 2026-02-25

## Permission Baseline

- Workspace RBAC permissions come from workspace membership and `shared/rbac.manifest.json`.
- Console permissions are enforced by console route guards and console-store permission checks.
- Assistant route access is feature-gated (`assistantEnabled`) and optionally permission-gated (`assistantRequiredPermission`).
- Assistant built-in tool allowlist is currently surface-scoped: app surface `[]`, admin surface `["workspace_rename"]`.

## Contract Shape

Each action entry defines:

- `UI`: where the action is triggered.
- `Business action`: canonical action id to expose.
- `Required permission`: expected permission contract.
- `Surfaces`: app/admin/console.
- `Payload`: key inputs.
- `Status`: `Implemented` or `Implemented (not currently surfaced in UI)` when backend/runtime exists but UI does not expose directly.

## Identity and Session

### `auth.register`
UI: Login page, register mode.
Business action: `auth.register`
Required permission: public.
Surfaces: app, admin, console.
Payload: `email`, `password`.
Status: Implemented.

### `auth.login.password`
UI: Login page, sign-in mode.
Business action: `auth.login.password`
Required permission: public.
Surfaces: app, admin, console.
Payload: `email`, `password`.
Status: Implemented.

### `auth.login.otp.request`
UI: Login page, OTP mode "Send one-time code".
Business action: `auth.login.otp.request`
Required permission: public.
Surfaces: app, admin, console.
Payload: `email`.
Status: Implemented.

### `auth.login.otp.verify`
UI: Login page, OTP mode submit; OTP callback completion.
Business action: `auth.login.otp.verify`
Required permission: public.
Surfaces: app, admin, console.
Payload: `email` + `token`, or callback `tokenHash`.
Status: Implemented.

### `auth.login.oauth.start`
UI: Login page OAuth buttons.
Business action: `auth.login.oauth.start`
Required permission: public.
Surfaces: app, admin, console.
Payload: `provider`, `returnTo`.
Status: Implemented.

### `auth.login.oauth.complete`
UI: OAuth callback handling in login/security flows.
Business action: `auth.login.oauth.complete`
Required permission: public for login callback; authenticated for link callback completion.
Surfaces: app, admin, console.
Payload: OAuth callback state payload.
Status: Implemented.

### `auth.password.reset.request`
UI: Login page forgot-password mode.
Business action: `auth.password.reset.request`
Required permission: public.
Surfaces: app, admin, console.
Payload: `email`.
Status: Implemented.

### `auth.password.recovery.complete`
UI: Reset-password page initialization from recovery link.
Business action: `auth.password.recovery.complete`
Required permission: valid recovery token/link.
Surfaces: app, admin, console.
Payload: `code` or `tokenHash` or `accessToken` + `refreshToken`.
Status: Implemented.

### `auth.password.reset`
UI: Reset-password page submit.
Business action: `auth.password.reset`
Required permission: authenticated recovery session.
Surfaces: app, admin, console.
Payload: `password`.
Status: Implemented.

### `auth.logout`
UI: Shell sign out.
Business action: `auth.logout`
Required permission: authenticated user.
Surfaces: app, admin, console.
Payload: none.
Status: Implemented.

### `auth.session.read`
UI: bootstrap/session refresh across app.
Business action: `auth.session.read`
Required permission: authenticated or anonymous session context.
Surfaces: app, admin, console.
Payload: none.
Status: Implemented.

## Workspace Access and Invitations

### `workspace.bootstrap.read`
UI: startup/workspaces screen/admin shell.
Business action: `workspace.bootstrap.read`
Required permission: authenticated user.
Surfaces: app, admin.
Payload: none.
Status: Implemented.

### `workspace.select`
UI: workspace picker/workspaces view/admin shell switcher.
Business action: `workspace.select`
Required permission: authenticated user + membership in target workspace.
Surfaces: app, admin.
Payload: `workspaceSlug`.
Status: Implemented.

### `workspace.invite.accept`
UI: workspaces view/admin shell invite dialog.
Business action: `workspace.invite.redeem`
Required permission: authenticated user + valid invite token.
Surfaces: app, admin.
Payload: `token`, `decision=accept`.
Status: Implemented.

### `workspace.invite.refuse`
UI: workspaces view/admin shell invite dialog.
Business action: `workspace.invite.redeem`
Required permission: authenticated user + valid invite token.
Surfaces: app, admin.
Payload: `token`, `decision=refuse`.
Status: Implemented.

### `console.bootstrap.read`
UI: console startup/invites flow.
Business action: `console.bootstrap.read`
Required permission: authenticated user.
Surfaces: console.
Payload: none.
Status: Implemented.

### `console.invite.accept`
UI: console invitations view.
Business action: `console.invite.redeem`
Required permission: authenticated user + valid invite token.
Surfaces: console.
Payload: `token`, `decision=accept`.
Status: Implemented.

### `console.invite.refuse`
UI: console invitations view.
Business action: `console.invite.redeem`
Required permission: authenticated user + valid invite token.
Surfaces: console.
Payload: `token`, `decision=refuse`.
Status: Implemented.

## Account Settings

### `settings.read`
UI: account settings page load.
Business action: `settings.read`
Required permission: authenticated user.
Surfaces: app, admin, console.
Payload: none.
Status: Implemented.

### `settings.profile.update`
UI: profile form save.
Business action: `settings.profile.update`
Required permission: authenticated user (self-service).
Surfaces: app, admin, console.
Payload: `displayName`.
Status: Implemented.

### `settings.profile.avatar.upload`
UI: profile avatar editor upload.
Business action: `settings.profile.avatar.upload`
Required permission: authenticated user (self-service).
Surfaces: app, admin, console.
Payload: multipart file upload.
Status: Implemented.

### `settings.profile.avatar.delete`
UI: profile remove avatar.
Business action: `settings.profile.avatar.delete`
Required permission: authenticated user (self-service).
Surfaces: app, admin, console.
Payload: none.
Status: Implemented.

### `settings.preferences.update`
UI: preferences form save.
Business action: `settings.preferences.update`
Required permission: authenticated user (self-service).
Surfaces: app, admin, console.
Payload: `theme`, `locale`, `timeZone`, `dateFormat`, `numberFormat`, `currencyCode`, `avatarSize`.
Status: Implemented.

### `settings.chat.update`
UI: chat settings form save.
Business action: `settings.chat.update`
Required permission: authenticated user (self-service).
Surfaces: app, admin, console.
Payload: `publicChatId`, `allowWorkspaceDms`, `allowGlobalDms`, `requireSharedWorkspaceForGlobalDm`, `discoverableByPublicChatId`.
Status: Implemented.

### `settings.notifications.update`
UI: notifications form save.
Business action: `settings.notifications.update`
Required permission: authenticated user (self-service).
Surfaces: app, admin, console.
Payload: `productUpdates`, `accountActivity`, `securityAlerts` (required true policy).
Status: Implemented.

### `settings.security.password.change`
UI: security password dialog.
Business action: `settings.security.password.change`
Required permission: authenticated user (self-service).
Surfaces: app, admin, console.
Payload: `currentPassword?`, `newPassword`, `confirmPassword`.
Status: Implemented.

### `settings.security.password_method.toggle`
UI: security method enable/disable.
Business action: `settings.security.password_method.toggle`
Required permission: authenticated user (self-service).
Surfaces: app, admin, console.
Payload: `enabled`.
Status: Implemented.

### `settings.security.oauth.link.start`
UI: security "Link" provider action.
Business action: `settings.security.oauth.link.start`
Required permission: authenticated user (self-service).
Surfaces: app, admin, console.
Payload: `provider`, `returnTo`.
Status: Implemented.

### `settings.security.oauth.link.complete`
UI: security OAuth callback handler.
Business action: `settings.security.oauth.link.complete`
Required permission: authenticated user (self-service).
Surfaces: app, admin, console.
Payload: OAuth callback payload.
Status: Implemented.

### `settings.security.oauth.unlink`
UI: security "Unlink" provider action.
Business action: `settings.security.oauth.unlink`
Required permission: authenticated user (self-service).
Surfaces: app, admin, console.
Payload: `providerId`.
Status: Implemented.

### `settings.security.sessions.logout_others`
UI: security "Sign out other devices".
Business action: `settings.security.sessions.logout_others`
Required permission: authenticated user (self-service).
Surfaces: app, admin, console.
Payload: none.
Status: Implemented.

### `settings.security.mfa.status.read`
UI: security MFA status card (read-only).
Business action: `settings.security.mfa.status.read`
Required permission: authenticated user (self-service).
Surfaces: app, admin, console.
Payload: none.
Status: Implemented.

## Deg2rad and History

### `deg2rad.calculate`
UI: DEG2RAD calculator submit.
Business action: `deg2rad.calculate`
Required permission: `history.write` (workspace member permission model).
Surfaces: app, admin.
Payload: `DEG2RAD_operation`, `DEG2RAD_degrees`.
Status: Implemented.

### `history.list`
UI: DEG2RAD history panel load/refresh/pagination.
Business action: `history.list`
Required permission: `history.read`.
Surfaces: app, admin.
Payload: `page`, `pageSize`.
Status: Implemented.

## Projects

### `projects.list`
UI: projects list page.
Business action: `projects.list`
Required permission: `projects.read`.
Surfaces: admin.
Payload: `page`, `pageSize`.
Status: Implemented.

### `projects.get`
UI: project details/edit initial load.
Business action: `projects.get`
Required permission: `projects.read`.
Surfaces: admin.
Payload: `projectId`.
Status: Implemented.

### `projects.create`
UI: add-project form submit.
Business action: `projects.create`
Required permission: `projects.write`.
Surfaces: admin.
Payload: `name`, `status`, `owner`, `notes`.
Status: Implemented.

### `projects.update`
UI: edit-project form submit.
Business action: `projects.update`
Required permission: `projects.write`.
Surfaces: admin.
Payload: `projectId`, `name`, `status`, `owner`, `notes`.
Status: Implemented.

## Chat

### `chat.workspace_room.ensure`
UI: chat initial room resolution.
Business action: `chat.workspace_room.ensure`
Required permission: route requires `chat.read`; write capability implied by thread creation side-effects.
Surfaces: admin.
Payload: none.
Status: Implemented.

### `chat.inbox.list`
UI: chat thread list load/refresh/pagination.
Business action: `chat.inbox.list`
Required permission: `chat.read`.
Surfaces: admin.
Payload: `cursor`, `limit`.
Status: Implemented.

### `chat.thread.messages.list`
UI: selected thread message load/older pagination.
Business action: `chat.thread.messages.list`
Required permission: `chat.read`.
Surfaces: admin.
Payload: `threadId`, `cursor`, `limit`.
Status: Implemented.

### `chat.dm.candidates.list`
UI: "Start DM" dialog search/refresh.
Business action: `chat.dm.candidates.list`
Required permission: `chat.read`.
Surfaces: admin.
Payload: `q`, `limit`.
Status: Implemented.

### `chat.dm.ensure`
UI: start DM with selected candidate.
Business action: `chat.dm.ensure`
Required permission: `chat.write` (expected for DM creation).
Surfaces: admin.
Payload: `targetPublicChatId`.
Status: Implemented.

### `chat.thread.message.send`
UI: composer send button/enter-to-send.
Business action: `chat.thread.message.send`
Required permission: `chat.write`.
Surfaces: admin.
Payload: `threadId`, `clientMessageId`, `text?`, `attachmentIds?`.
Status: Implemented.

### `chat.attachment.reserve`
UI: attachment upload workflow.
Business action: `chat.attachment.reserve`
Required permission: `chat.write`.
Surfaces: admin.
Payload: `threadId`, file metadata.
Status: Implemented.

### `chat.attachment.upload`
UI: attachment upload workflow.
Business action: `chat.attachment.upload`
Required permission: `chat.write`.
Surfaces: admin.
Payload: `threadId`, `attachmentId`, file.
Status: Implemented.

### `chat.attachment.delete`
UI: remove composer attachment.
Business action: `chat.attachment.delete`
Required permission: `chat.write`.
Surfaces: admin.
Payload: `threadId`, `attachmentId`.
Status: Implemented.

### `chat.thread.read.mark`
UI: auto mark-as-read in runtime.
Business action: `chat.thread.read.mark`
Required permission: `chat.read`.
Surfaces: admin.
Payload: `threadId`, `threadSeq`.
Status: Implemented.

### `chat.thread.typing.emit`
UI: typing indicator emit from composer.
Business action: `chat.thread.typing.emit`
Required permission: `chat.write` (expected).
Surfaces: admin.
Payload: `threadId`.
Status: Implemented.

## Assistant Conversations and Tools

### `assistant.conversations.list`
UI: assistant history panel.
Business action: `assistant.conversations.list`
Required permission: assistant route access policy (`assistantEnabled` + optional `assistantRequiredPermission`).
Surfaces: app, admin.
Payload: `page`, `pageSize`.
Status: Implemented.

### `assistant.conversation.messages.list`
UI: selecting a historical conversation.
Business action: `assistant.conversation.messages.list`
Required permission: assistant route access policy.
Surfaces: app, admin.
Payload: `conversationId`, `page`, `pageSize`.
Status: Implemented.

### `assistant.chat.stream`
UI: assistant message send/stream.
Business action: `assistant.chat.stream`
Required permission: assistant route access policy.
Surfaces: app, admin.
Payload: `messageId`, `conversationId?`, `input`, `history`.
Status: Implemented.

### `assistant.stream.cancel`
UI: stop button during stream.
Business action: `assistant.stream.cancel`
Required permission: assistant route access policy.
Surfaces: app, admin.
Payload: stream context.
Status: Implemented.

### `assistant.conversation.start_new`
UI: "Start new conversation".
Business action: `assistant.conversation.start_new`
Required permission: assistant route access policy.
Surfaces: app, admin.
Payload: none.
Status: Implemented.

### `assistant.tool.workspace_rename`
UI: assistant tool invocation (when model chooses tool).
Business action: `assistant.tool.workspace_rename`
Required permission: `workspace.settings.update`.
Surfaces: admin only (tool allowlist).
Payload: `name`.
Status: Implemented.

## Workspace Settings, Members, and Transcripts

### `workspace.settings.read`
UI: workspace settings page load.
Business action: `workspace.settings.read`
Required permission: `workspace.settings.view` or `workspace.settings.update`.
Surfaces: admin.
Payload: none.
Status: Implemented.

### `workspace.settings.update`
UI: workspace settings save.
Business action: `workspace.settings.update`
Required permission: `workspace.settings.update`.
Surfaces: admin.
Payload: `name`, `color`, `avatarUrl`, `invitesEnabled`, `assistantTranscriptMode`, `assistantSystemPromptApp`, `appDenyEmails`.
Status: Implemented.

### `workspace.members.list`
UI: members admin panel.
Business action: `workspace.members.list`
Required permission: `workspace.members.view`.
Surfaces: admin.
Payload: none.
Status: Implemented.

### `workspace.invites.list`
UI: members admin panel pending invites.
Business action: `workspace.invites.list`
Required permission: `workspace.members.view`.
Surfaces: admin.
Payload: none.
Status: Implemented.

### `workspace.invite.create`
UI: members admin invite form.
Business action: `workspace.invite.create`
Required permission: `workspace.members.invite`.
Surfaces: admin.
Payload: `email`, `roleId`.
Status: Implemented.

### `workspace.invite.revoke`
UI: members admin revoke button.
Business action: `workspace.invite.revoke`
Required permission: `workspace.invites.revoke`.
Surfaces: admin.
Payload: `inviteId`.
Status: Implemented.

### `workspace.member.role.update`
UI: members admin role selector.
Business action: `workspace.member.role.update`
Required permission: `workspace.members.manage`.
Surfaces: admin.
Payload: `memberUserId`, `roleId`.
Status: Implemented.

### `workspace.ai.transcripts.list`
UI: workspace transcript explorer list.
Business action: `workspace.ai.transcripts.list`
Required permission: `workspace.ai.transcripts.read`.
Surfaces: admin.
Payload: `page`, `pageSize`, `status?`, `createdByUserId?`.
Status: Implemented.

### `workspace.ai.transcript.messages.get`
UI: workspace transcript conversation detail.
Business action: `workspace.ai.transcript.messages.get`
Required permission: `workspace.ai.transcripts.read`.
Surfaces: admin.
Payload: `conversationId`, `page`, `pageSize`.
Status: Implemented.

### `workspace.ai.transcript.export`
UI: workspace transcript export button.
Business action: `workspace.ai.transcript.export`
Required permission: endpoint should enforce `workspace.ai.transcripts.export` (route currently gated by read permission).
Surfaces: admin.
Payload: `conversationId`, `format`, `limit`.
Status: Implemented.

## Workspace Billing

### `workspace.billing.plan_state.get`
UI: workspace billing plan panel load/refresh.
Business action: `workspace.billing.plan_state.get`
Required permission: `workspace.billing.manage`.
Surfaces: admin.
Payload: none.
Status: Implemented.

### `workspace.billing.products.list`
UI: commerce panel catalog load.
Business action: `workspace.billing.products.list`
Required permission: `workspace.billing.manage`.
Surfaces: admin.
Payload: none.
Status: Implemented.

### `workspace.billing.limitations.get`
UI: usage limits panel load/refresh.
Business action: `workspace.billing.limitations.get`
Required permission: `workspace.billing.manage`.
Surfaces: admin.
Payload: none.
Status: Implemented.

### `workspace.billing.purchases.list`
UI: purchase history panel load.
Business action: `workspace.billing.purchases.list`
Required permission: `workspace.billing.manage`.
Surfaces: admin.
Payload: none.
Status: Implemented.

### `workspace.billing.plan_change.request`
UI: change plan and cancel current plan actions.
Business action: `workspace.billing.plan_change.request`
Required permission: `workspace.billing.manage`.
Surfaces: admin.
Payload: `planCode`, `successPath`, `cancelPath`.
Status: Implemented.

### `workspace.billing.plan_change.cancel_pending`
UI: cancel scheduled change.
Business action: `workspace.billing.plan_change.cancel_pending`
Required permission: `workspace.billing.manage`.
Surfaces: admin.
Payload: none.
Status: Implemented.

### `workspace.billing.payment_link.create.catalog`
UI: one-off catalog "Buy now".
Business action: `workspace.billing.payment_link.create`
Required permission: `workspace.billing.manage`.
Surfaces: admin.
Payload: `successPath`, `lineItems[{priceId, quantity}]`.
Status: Implemented.

### `workspace.billing.payment_link.create.ad_hoc`
UI: not currently wired in `BillingCommerceClientElement` for this app, but action exists in view model.
Business action: `workspace.billing.payment_link.create`
Required permission: `workspace.billing.manage`.
Surfaces: admin.
Payload: `successPath`, `oneOff{name, amountMinor, quantity}`.
Status: Implemented (not currently surfaced in UI).

## Console Settings, Members, Errors, Transcripts, Billing

### `console.settings.read`
UI: console home load.
Business action: `console.settings.read`
Required permission: console access.
Surfaces: console.
Payload: none.
Status: Implemented.

### `console.settings.update`
UI: console home save.
Business action: `console.settings.update`
Required permission: `console.assistant.settings.manage`.
Surfaces: console.
Payload: `assistantSystemPromptWorkspace`.
Status: Implemented.

### `console.members.list`
UI: console members page.
Business action: `console.members.list`
Required permission: `console.members.view`.
Surfaces: console.
Payload: none.
Status: Implemented.

### `console.invites.list`
UI: console members page pending invites.
Business action: `console.invites.list`
Required permission: `console.members.view`.
Surfaces: console.
Payload: none.
Status: Implemented.

### `console.invite.create`
UI: console members invite form.
Business action: `console.invite.create`
Required permission: `console.members.invite`.
Surfaces: console.
Payload: `email`, `roleId`.
Status: Implemented.

### `console.invite.revoke`
UI: console members revoke invite.
Business action: `console.invite.revoke`
Required permission: `console.invites.revoke`.
Surfaces: console.
Payload: `inviteId`.
Status: Implemented.

### `console.member.role.update`
UI: console member role selector.
Business action: `console.member.role.update`
Required permission: `console.members.manage`.
Surfaces: console.
Payload: `memberUserId`, `roleId`.
Status: Implemented.

### `console.errors.browser.list`
UI: browser errors list.
Business action: `console.errors.browser.list`
Required permission: `console.errors.browser.read`.
Surfaces: console.
Payload: `page`, `pageSize`.
Status: Implemented.

### `console.errors.browser.get`
UI: browser error detail view.
Business action: `console.errors.browser.get`
Required permission: `console.errors.browser.read`.
Surfaces: console.
Payload: `errorId`.
Status: Implemented.

### `console.errors.browser.simulate_client`
UI: browser error simulation button.
Business action: `console.errors.browser.simulate_client`
Required permission: console access in current UI (client-side crash trigger).
Surfaces: console.
Payload: simulation variant.
Status: Implemented (client-side action, no backend mutation).

### `console.errors.server.list`
UI: server errors list.
Business action: `console.errors.server.list`
Required permission: `console.errors.server.read`.
Surfaces: console.
Payload: `page`, `pageSize`.
Status: Implemented.

### `console.errors.server.get`
UI: server error detail view.
Business action: `console.errors.server.get`
Required permission: `console.errors.server.read`.
Surfaces: console.
Payload: `errorId`.
Status: Implemented.

### `console.errors.server.simulate`
UI: server error simulation button.
Business action: `console.errors.server.simulate`
Required permission: `console.errors.server.read` (current route/guard context).
Surfaces: console.
Payload: `kind`.
Status: Implemented.

### `console.ai.transcripts.list`
UI: console transcript explorer list.
Business action: `console.ai.transcripts.list`
Required permission: `console.ai.transcripts.read_all`.
Surfaces: console.
Payload: `page`, `pageSize`, `workspaceId?`, `status?`.
Status: Implemented.

### `console.ai.transcript.messages.get`
UI: console transcript conversation detail.
Business action: `console.ai.transcript.messages.get`
Required permission: `console.ai.transcripts.read_all`.
Surfaces: console.
Payload: `conversationId`, `page`, `pageSize`.
Status: Implemented.

### `console.ai.transcripts.export`
UI: console transcript export.
Business action: `console.ai.transcripts.export`
Required permission: `console.ai.transcripts.read_all`.
Surfaces: console.
Payload: `conversationId`, `format`, `limit`.
Status: Implemented.

### `console.billing.events.list`
UI: billing events explorer.
Business action: `console.billing.events.list`
Required permission: `console.billing.events.read_all`.
Surfaces: console.
Payload: `page`, `pageSize`, `workspaceSlug?`, `userId?`, `billableEntityId?`, `operationKey?`, `providerEventId?`, `source?`.
Status: Implemented.

### `console.billing.plans.list`
UI: billing plans admin page.
Business action: `console.billing.plans.list`
Required permission: `console.billing.catalog.manage`.
Surfaces: console.
Payload: none.
Status: Implemented.

### `console.billing.plan.create`
UI: create billing plan dialog.
Business action: `console.billing.plan.create`
Required permission: `console.billing.catalog.manage`.
Surfaces: console.
Payload: `code`, `name`, `description?`, `isActive`, `corePrice?`, `entitlements`.
Status: Implemented.

### `console.billing.plan.update`
UI: edit billing plan dialog.
Business action: `console.billing.plan.update`
Required permission: `console.billing.catalog.manage`.
Surfaces: console.
Payload: `planId`, mutable plan fields + optional `corePrice`.
Status: Implemented.

### `console.billing.settings.read`
UI: billing behavior section.
Business action: `console.billing.settings.read`
Required permission: `console.billing.catalog.manage`.
Surfaces: console.
Payload: none.
Status: Implemented.

### `console.billing.settings.update`
UI: save billing behavior section.
Business action: `console.billing.settings.update`
Required permission: `console.billing.catalog.manage`.
Surfaces: console.
Payload: `paidPlanChangePaymentMethodPolicy`.
Status: Implemented.

### `console.billing.provider_prices.list.plan`
UI: billing plan create/edit provider-price selector.
Business action: `console.billing.provider_prices.list`
Required permission: `console.billing.catalog.manage`.
Surfaces: console.
Payload: `active`, `limit`, `target="plan"`.
Status: Implemented.

### `console.billing.products.list`
UI: billing products admin page.
Business action: `console.billing.products.list`
Required permission: `console.billing.catalog.manage`.
Surfaces: console.
Payload: none.
Status: Implemented.

### `console.billing.product.create`
UI: create billing product dialog.
Business action: `console.billing.product.create`
Required permission: `console.billing.catalog.manage`.
Surfaces: console.
Payload: `code`, `name`, `description?`, `productKind`, `isActive`, `price`, `entitlements`.
Status: Implemented.

### `console.billing.product.update`
UI: edit billing product dialog.
Business action: `console.billing.product.update`
Required permission: `console.billing.catalog.manage`.
Surfaces: console.
Payload: `productId`, mutable product fields + optional `price`.
Status: Implemented.

### `console.billing.provider_prices.list.product`
UI: billing product create/edit provider-price selector.
Business action: `console.billing.provider_prices.list`
Required permission: `console.billing.catalog.manage`.
Surfaces: console.
Payload: `active`, `limit`, `target="product"`.
Status: Implemented.

## Placeholder and Non-Business UI

### `workspace.audit_activity.read`
UI: workspace audit/activity tab currently placeholder.
Business action: pending.
Required permission: would align with workspace monitoring permission model when implemented.
Surfaces: admin.
Payload: pending.
Status: Not implemented.

### `choice_two.read`
UI: choice-2 placeholder screen.
Business action: pending.
Required permission: workspace-required route.
Surfaces: admin (and app where enabled).
Payload: none.
Status: Not implemented.

## Assistant Exposure Gap Summary

To satisfy the requirement "everything possible in UI must be possible as assistant business actions", assistant callable actions should at minimum cover:

- all settings actions (profile, preferences, chat, notifications, security),
- workspace member/invite/role management,
- project CRUD,
- chat send/DM/initiate workflows,
- workspace and console billing management workflows,
- transcript exploration/export workflows,
- plus existing `assistant.tool.workspace_rename`.

Current built-in assistant tool coverage is only `assistant.tool.workspace_rename` on admin surface.

