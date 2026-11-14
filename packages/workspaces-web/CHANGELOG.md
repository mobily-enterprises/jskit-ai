# Changelog

## Unreleased

- The notice for a logged invitation reads "Invite created. Outside production its email is logged, not sent: copy the link to share it."
- After **Send invite**, the members panel has a notice for the delivery status `held`, an invitation whose email the application keeps and sends once its email is set up: "Invite created. Email isn't set up yet, so it will be sent once it is: copy the link to share it now." (`jskit.workspaces.members.inviteCreatedHeld`), a success like the other statuses that send the person to the invite link. A status the panel does not know now shows the delivery result's own `message`, in the person's language when its `messageCode` has a translation, and the general "Invite created. Copy the invite link to share it." only when the result has none. Before, both showed the general notice, which said nothing of an email the application will still send, or of what the mailer reported.
- A workspace's bootstrap answer applies when the person has moved to another page of the same workspace before it arrives. It was dropped because the page had changed, and a move within a workspace asks nothing again, so a person who tapped another page while the first one loaded kept no permissions until a reload: a short menu, and every command that needs a permission refused. The answer belongs to the workspace, not to a page (its request names only the workspace slug, and nothing in it depends on the page), so an answer for the workspace the route is in now applies, and one for a workspace the route has left is still dropped, as the move there asked again. A 403 or 404 for the workspace applies after such a move too. The bootstrap request's `meta` no longer carries the page's `path`, which nothing reads.
- After **Send invite**, the members panel's notice says whether an email went out. In a test copy (whose invitation emails are only simulated) and in an app with no invite mailer, it showed the general success "Invite created. Copy the invite link to share it.", which never said that no email had gone out, so an administrator could believe the invitation had been emailed. It now says "Invite created. This is a test copy, so no email was sent: copy the link to share it." and "Invite created. Email isn't set up, so no email was sent: copy the link to share it.". A failed email ("Invite created, but email delivery failed. …") is shown as a warning instead of a success. In each case the invite link and its Copy button stay under the form, as before. A delivery status the panel does not know still says only "Invite created. Copy the invite link to share it.". The notices come from the package's own catalog, not from the server's English: `jskit.workspaces.members.inviteCreatedSimulated` and `jskit.workspaces.members.inviteCreatedMailerUnconfigured` are new message keys. The warning uses `@jskit-ai/http-web`'s new `useUiFeedback().warning()`.
- A signed-out person opening a page no longer freezes the browser tab. The workspaces runtime started checking surface access while the router still sat on its start location `/`, before its opening navigation had finished, so in an app whose default surface needs sign-in it redirected that `/` to the default surface and cancelled the navigation to the page the person opened. Each cancelled navigation then ran the router's `afterEach`, which redirected again and cancelled the next one, in a loop of microtasks that never let the page render or answer (the tab stayed on its loading screen). The runtime now leaves the route alone until the opening navigation finishes, and its `afterEach` ignores navigations that failed: a cancelled, aborted or duplicate navigation leaves the route where it was, and the one that replaced it runs its own check.
- Inviting, revoking an invite, changing a member's role and removing a member reload only the invites or the members, not the workspace's role catalogue too: the catalogue is configuration that does not change with them, and each members response already carries it. `useWorkspaceMembersActions` no longer takes `workspaceRolesView`.
- The members screen loads its members and pending-invites lists 20 at a time, with a Load more button under each list while it has more. A refetch, such as a realtime change, reads every loaded page again. The members admin status adds `hasMoreMembers`, `isLoadingMoreMembers`, `hasMoreInvites` and `isLoadingMoreInvites`, and its actions add `loadMoreMembers` and `loadMoreInvites`. `useWorkspaceMembersPage` no longer passes the role catalog view to `useWorkspaceMembersActions`.
- The members screen's invite-role and member-role fields are http-web's `SelectField`, bound to `loading` while the workspace's role catalog loads, so a stored role id never shows as text before its label; the members admin status says `isLoadingRoles`.
- The invite form's email and role fields have no margin under them, since each keeps its supporting-text line (`@jskit-ai/material-web` no longer sets `hideDetails: "auto"`).
- The workspace-surfaces pattern's pending-invitations cue links to the account settings' invitations section at its own address, `/account/invites`, as users-web's routed sections have it, instead of `/account?section=invites`.
- The workspaces and invitations screens and the workspace-surfaces pattern's panels sit directly on the page, without bordered sheets; the invite landing and the members screen use elevated Material 3 cards; titles use Material 3 type classes instead of hand-sized ones. Buttons are Material 3's 40dp buttons inside material-web's 48dp touch target, no longer stretched to 48px; the workspace list's and invitations' buttons are default size instead of small.
- Icons are Material Symbols `$aliases` (from `@jskit-ai/material-web`) instead of `@mdi/js` paths, and text uses Vuetify 4's Material 3 type classes (`text-body-large`, `text-title-medium`, ...) instead of Material 2 ones, which Vuetify 4 no longer styles. Upgrading: see the guide's [Move an app to the Material 3 defaults](https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/material-3-migration).

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
