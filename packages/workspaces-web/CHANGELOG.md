# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (111)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.workspaces.common.retry`
- `jskit.workspaces.common.retrying`
- `jskit.workspaces.common.refuse`
- `jskit.workspaces.common.refusing`
- `jskit.workspaces.common.join`
- `jskit.workspaces.common.joining`
- `jskit.workspaces.common.workspaces`
- `jskit.workspaces.common.invitations`
- `jskit.workspaces.common.noPendingInvitations`
- `jskit.workspaces.common.slugAndRole`
- `jskit.workspaces.common.role`
- `jskit.workspaces.common.unknownDate`
- `jskit.workspaces.common.surfaceNotConfigured`
- `jskit.workspaces.common.openWorkspaceFailed`
- `jskit.workspaces.common.respondToInvitationFailed`
- `jskit.workspaces.common.acceptInvitationFailed`
- `jskit.workspaces.common.invitationRefused`
- `jskit.workspaces.common.pendingInviteMark`
- `jskit.workspaces.members.slugRequired`
- `jskit.workspaces.members.loadSettingsFailed`
- `jskit.workspaces.members.loadRolesFailed`
- `jskit.workspaces.members.loadMembersFailed`
- `jskit.workspaces.members.loadInvitesFailed`
- `jskit.workspaces.members.createInviteFailed`
- `jskit.workspaces.members.revokeInviteFailed`
- `jskit.workspaces.members.inviteRevoked`
- `jskit.workspaces.members.updateRoleFailed`
- `jskit.workspaces.members.roleUpdated`
- `jskit.workspaces.members.removeFailed`
- `jskit.workspaces.members.removed`
- `jskit.workspaces.members.memberIdInvalid`
- `jskit.workspaces.members.inviteSent`
- `jskit.workspaces.members.inviteCreatedDeliveryFailed`
- `jskit.workspaces.members.inviteCreated`
- `jskit.workspaces.members.linkReady`
- `jskit.workspaces.members.linkCopied`
- `jskit.workspaces.members.copyLinkFailed`
- `jskit.workspaces.membersAdmin.inviteTitle`
- `jskit.workspaces.membersAdmin.inviteSubtitle`
- `jskit.workspaces.membersAdmin.invitesUnavailable`
- `jskit.workspaces.membersAdmin.invitesOff`
- `jskit.workspaces.membersAdmin.noInvitePermission`
- `jskit.workspaces.membersAdmin.email`
- `jskit.workspaces.membersAdmin.role`
- `jskit.workspaces.membersAdmin.sendInvite`
- `jskit.workspaces.membersAdmin.inviteLink`
- `jskit.workspaces.membersAdmin.copy`
- `jskit.workspaces.membersAdmin.teamTitle`
- `jskit.workspaces.membersAdmin.teamSubtitle`
- `jskit.workspaces.membersAdmin.noViewPermission`
- `jskit.workspaces.membersAdmin.members`
- `jskit.workspaces.membersAdmin.owner`
- `jskit.workspaces.membersAdmin.remove`
- `jskit.workspaces.membersAdmin.pendingInvites`
- `jskit.workspaces.membersAdmin.inviteCaption`
- `jskit.workspaces.membersAdmin.revoke`
- `jskit.workspaces.membersAdmin.noPendingInvites`
- `jskit.workspaces.membersAdmin.linkSent`
- `jskit.workspaces.membersAdmin.linkDeliveryFailed`
- `jskit.workspaces.membersAdmin.linkReady`
- `jskit.workspaces.workspacesView.title`
- `jskit.workspaces.workspacesView.subtitle`
- `jskit.workspaces.workspacesView.loadFailed`
- `jskit.workspaces.workspacesView.loadFailedTitle`
- `jskit.workspaces.workspacesView.noWorkspace`
- `jskit.workspaces.workspacesView.nameLabel`
- `jskit.workspaces.workspacesView.slugLabel`
- `jskit.workspaces.workspacesView.create`
- `jskit.workspaces.workspacesView.creating`
- `jskit.workspaces.workspacesView.createFailed`
- `jskit.workspaces.workspacesView.nameRequired`
- `jskit.workspaces.workspacesView.askAdministrator`
- `jskit.workspaces.workspacesView.unavailableOnSurface`
- `jskit.workspaces.workspacesView.open`
- `jskit.workspaces.workspacesView.opening`
- `jskit.workspaces.workspacesView.unavailable`
- `jskit.workspaces.workspacesView.navigationUnavailable`
- `jskit.workspaces.workspacesView.acceptFailed`
- `jskit.workspaces.workspacesView.refuseFailed`
- `jskit.workspaces.inviteLanding.unavailableTitle`
- `jskit.workspaces.inviteLanding.unavailableMessage`
- `jskit.workspaces.inviteLanding.expiredTitle`
- `jskit.workspaces.inviteLanding.expiredMessage`
- `jskit.workspaces.inviteLanding.acceptedTitle`
- `jskit.workspaces.inviteLanding.acceptedMessage`
- `jskit.workspaces.inviteLanding.revokedTitle`
- `jskit.workspaces.inviteLanding.revokedMessage`
- `jskit.workspaces.inviteLanding.invitationFor`
- `jskit.workspaces.inviteLanding.signInToAccept`
- `jskit.workspaces.inviteLanding.createAccount`
- `jskit.workspaces.inviteLanding.signIn`
- `jskit.workspaces.inviteLanding.accept`
- `jskit.workspaces.inviteLanding.loadFailed`
- `jskit.workspaces.inviteLanding.invitedEmailFallback`
- `jskit.workspaces.inviteLanding.workspaceFallback`
- `jskit.workspaces.accountInvites.subtitle`
- `jskit.workspaces.accountInvites.loadFailed`
- `jskit.workspaces.accountInvites.accepted`
- `jskit.workspaces.accountInvites.refuseFailed`
- `jskit.workspaces.accountInvites.noLongerExists`
- `jskit.workspaces.accountInvites.crossOriginUnavailable`
- `jskit.workspaces.selector.targetNotConfigured`
- `jskit.workspaces.selector.targetNeedsWorkspace`
- `jskit.workspaces.selector.routerUnavailable`
- `jskit.workspaces.selector.switchFailed`
- `jskit.workspaces.selector.workspaceFallback`
- `jskit.workspaces.menu.members`
- `jskit.workspaces.menu.workspaceSettings`
- `jskit.workspaces.menu.goToSurface`
- `jskit.workspaces.menu.goToAnySurface`
- `jskit.workspaces.tools.adminCog`

</details>
