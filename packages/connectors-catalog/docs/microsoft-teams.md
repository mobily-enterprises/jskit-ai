# Microsoft Teams

Provider ID `microsoft-teams`; export `microsoftTeamsProvider` from
`@jskit-ai/connectors-catalog/server/microsoft-teams`.

Follow all [Microsoft registration steps](microsoft-oauth.md), selecting
**Multiple Entra ID tenants**. This module uses the `organizations` authority;
personal Microsoft accounts are unsupported. Under **API permissions → Microsoft
Graph → Delegated permissions**, add `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `User.Read` and `offline_access`.
The form requires team/channel/profile reads. Optional channel send and all-user
profile read start selected; clear them for listing teams only. Channel-message
read and chat read/write are also available. The operations below use these permissions separately; `teams.list` itself uses only `Team.ReadBasic.All`.
The user's organization must provide Teams access and permit consent.

`teams.list` verifies access with `GET /v1.0/me/joinedTeams`. Verification input
is `{}`. This endpoint does not support OData query parameters, so this fragment
does not offer page size, search or filter controls. It returns the `value`
array of teams in which the signed-in user has direct membership. Shared-channel
access does not necessarily imply that the host team appears here. That listing does not itself read/send messages; use the separate operations below. Team creation and membership changes remain unsupported.
[Joined teams API](https://learn.microsoft.com/en-us/graph/api/user-list-joinedteams?view=graph-rest-1.0).

The common continuation input is accepted only for a same-resource provider
link if one is returned; do not manufacture a Teams paging URL. The fragment
does not introduce query parameters on its initial request.

AI provisioning is **API-capable after authorization** using Graph application
creation and credential endpoints. Apply the audience and delegated permissions
above. Administrator consent and tenant restrictions remain provider-controlled.
The application owner supplies its registration and private Env bindings using
the common guide. Separate registrations do not remove overlapping tenant/service
limits.

Use the common JSON/file-store pattern from a CLI or backend. Automated tests
verify the organization endpoint, exact permission, query-free initial request,
scope denial, cancellation, refresh, isolation and encrypted persistence. Live
Teams usage and generated applications are excluded.

## Editor credential handoff

The inline guide covers Entra registration/audience, exact Web redirect,
delegated permissions and administrator consent, secret Value versus Secret ID,
and rotation. Save `env:MICROSOFT_TEAMS_CLIENT_SECRET` and
`env:MICROSOFT_TEAMS_CALLBACK_URL`, then use **Set credential in Env** and
**Open Env** for their values. Shared/assistant **Connect account** uses the
prepared project runtime. Per-user connections belong to authenticated users
of that app. No Vibe64 gateway or editor-owned provider registration is used.
Local disconnect does not revoke provider consent.

## Conversations in CLI and generated apps

`channels.list({teamId})` requires Channel.ReadBasic.All.
`messages.list({teamId,channelId,pageSize?})` and
`replies.list({teamId,channelId,messageId})` require ChannelMessage.Read.All.
`messages.send({teamId,channelId,text})` and
`replies.send({teamId,channelId,messageId,text})` require ChannelMessage.Send.
Existing chats use `chats.list({})`, `chatMessages.list({chatId,pageSize?})` and
`chatMessages.send({chatId,text})` with Chat.ReadWrite. Retain returned resource IDs
and same-resource nextLink values. Text sends are bounded to 20,000 characters.

App authorization must approve the destination and text; connected permissions
are not permission to expose an unrestricted send endpoint. Do not blindly retry
uncertain sends. Sanitize returned HTML before rendering. JSKIT CLI apps call the
same connection service; other frameworks use Graph and their own Env/grant store.

**LIMITATIONS:** No team/chat creation, membership administration, message edit/delete,
attachments, meeting bot or editor tool attachment. Example: read a channel and
post a status update, not a Teams client or automatic team administrator. No live
provider or generated-app proof.

[Channel messages](https://learn.microsoft.com/en-us/graph/api/channel-list-messages?view=graph-rest-1.0),
[channel send](https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0),
[chat send](https://learn.microsoft.com/en-us/graph/api/chat-post-messages?view=graph-rest-1.0).
