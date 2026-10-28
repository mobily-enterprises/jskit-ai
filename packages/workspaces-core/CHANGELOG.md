# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- Workspace invitation emails are rendered in the recipient's saved locale (`createServerI18n`); `WorkspacesFeature` requires the `runtime.app-root` capability.

### New message keys (34)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.workspaces.auth.required`
- `jskit.workspaces.user.invalidPayload`
- `jskit.workspaces.workspace.slugUnavailable`
- `jskit.workspaces.workspace.creationDisabled`
- `jskit.workspaces.workspace.nameRequired`
- `jskit.workspaces.workspace.contextDisabled`
- `jskit.workspaces.workspace.slugRequired`
- `jskit.workspaces.workspace.notFound`
- `jskit.workspaces.workspace.accessDenied`
- `jskit.workspaces.member.roleNotAssignable`
- `jskit.workspaces.member.notFound`
- `jskit.workspaces.member.ownerRoleLocked`
- `jskit.workspaces.member.ownerNotRemovable`
- `jskit.workspaces.invite.disabled`
- `jskit.workspaces.invite.notFound`
- `jskit.workspaces.invite.notFoundOrHandled`
- `jskit.workspaces.invite.invitationNotFoundOrHandled`
- `jskit.workspaces.invite.workspaceMissing`
- `jskit.workspaces.invite.expired`
- `jskit.workspaces.invite.tokenMismatch`
- `jskit.workspaces.invite.tokenRequired`
- `jskit.workspaces.invite.tokenInvalid`
- `jskit.workspaces.invite.emailMismatchUser`
- `jskit.workspaces.invite.emailMismatchAccount`
- `jskit.workspaces.invite.notAvailable`
- `jskit.workspaces.invite.mailerUnconfigured`
- `jskit.workspaces.invite.sendFailed`
- `jskit.workspaces.inviteEmail.subject`
- `jskit.workspaces.inviteEmail.intro`
- `jskit.workspaces.inviteEmail.introFromInviter`
- `jskit.workspaces.inviteEmail.expiry`
- `jskit.workspaces.inviteEmail.openLink`
- `jskit.workspaces.inviteEmail.accept`
- `jskit.workspaces.inviteEmail.workspaceFallback`

</details>

### Codes (27)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `workspaces.auth.required` | Authentication required. |
| `workspaces.user.invalidPayload` | Invalid authenticated user payload. |
| `workspaces.workspace.slugUnavailable` | Unable to generate unique workspace slug. |
| `workspaces.workspace.creationDisabled` | Workspace creation is disabled for this tenancy mode. |
| `workspaces.workspace.nameRequired` | Workspace name is required. |
| `workspaces.workspace.contextDisabled` | Workspace context is disabled. |
| `workspaces.workspace.slugRequired` | workspaceSlug is required. |
| `workspaces.workspace.notFound` | Workspace not found. |
| `workspaces.workspace.accessDenied` | You do not have access to this workspace. |
| `workspaces.member.roleNotAssignable` | Role is not assignable. |
| `workspaces.member.notFound` | Member not found. |
| `workspaces.member.ownerRoleLocked` | Cannot change workspace owner role. |
| `workspaces.member.ownerNotRemovable` | Cannot remove workspace owner. |
| `workspaces.invite.disabled` | Workspace invitations are disabled. |
| `workspaces.invite.notFound` | Invite not found. |
| `workspaces.invite.notFoundOrHandled` | Invite not found or already handled. |
| `workspaces.invite.invitationNotFoundOrHandled` | Invitation not found or already handled. |
| `workspaces.invite.workspaceMissing` | Invitation workspace no longer exists. |
| `workspaces.invite.expired` | Invitation has expired. |
| `workspaces.invite.tokenMismatch` | Invitation token does not match the saved invitation. |
| `workspaces.invite.tokenRequired` | Invite token is required. |
| `workspaces.invite.tokenInvalid` | Invite token is invalid. |
| `workspaces.invite.emailMismatchUser` | Invitation email does not match authenticated user. |
| `workspaces.invite.emailMismatchAccount` | Invitation email does not match account email. |
| `workspaces.invite.notAvailable` | Invitation is not available. |
| `workspaces.invite.mailerUnconfigured` | No workspace invite mailer is configured. |
| `workspaces.invite.sendFailed` | Unable to send workspace invite email. |
