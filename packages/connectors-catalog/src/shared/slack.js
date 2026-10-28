import { createSchema } from "json-rest-schema";
import { secretReference } from "@jskit-ai/connectors-core/shared/configuration";

const scopes = [
  {"value": "channels:history", "label": "jskit.connectors.slack.scopes.channelsHistory.label", "actors": ["user", "bot"], "recommended": true},
  {"value": "channels:read", "label": "jskit.connectors.slack.scopes.channelsRead.label", "actors": ["user", "bot"], "recommended": true},
  {"value": "bookmarks:read", "label": "jskit.connectors.slack.scopes.bookmarksRead.label", "actors": ["user", "bot"]},
  {"value": "bookmarks:write", "label": "jskit.connectors.slack.scopes.bookmarksWrite.label", "actors": ["user", "bot"]},
  {"value": "calls:read", "label": "jskit.connectors.slack.scopes.callsRead.label", "actors": ["user", "bot"]},
  {"value": "calls:write", "label": "jskit.connectors.slack.scopes.callsWrite.label", "actors": ["user", "bot"]},
  {"value": "canvases:read", "label": "jskit.connectors.slack.scopes.canvasesRead.label", "actors": ["user", "bot"]},
  {"value": "canvases:write", "label": "jskit.connectors.slack.scopes.canvasesWrite.label", "actors": ["user", "bot"]},
  {"value": "channels:write", "label": "jskit.connectors.slack.scopes.channelsWrite.label", "actors": ["user"]},
  {"value": "channels:write.invites", "label": "jskit.connectors.slack.scopes.channelsWriteInvites.label", "actors": ["user", "bot"]},
  {"value": "channels:write.topic", "label": "jskit.connectors.slack.scopes.channelsWriteTopic.label", "actors": ["user", "bot"]},
  {"value": "chat:write", "label": "jskit.connectors.slack.scopes.chatWrite.label", "actors": ["user", "bot"]},
  {"value": "dnd:read", "label": "jskit.connectors.slack.scopes.dndRead.label", "actors": ["user", "bot"]},
  {"value": "dnd:write", "label": "jskit.connectors.slack.scopes.dndWrite.label", "actors": ["user"]},
  {"value": "emoji:read", "label": "jskit.connectors.slack.scopes.emojiRead.label", "actors": ["user", "bot"]},
  {"value": "files:read", "label": "jskit.connectors.slack.scopes.filesRead.label", "actors": ["user", "bot"]},
  {"value": "files:write", "label": "jskit.connectors.slack.scopes.filesWrite.label", "actors": ["user", "bot"]},
  {"value": "groups:history", "label": "jskit.connectors.slack.scopes.groupsHistory.label", "actors": ["user", "bot"]},
  {"value": "groups:read", "label": "jskit.connectors.slack.scopes.groupsRead.label", "actors": ["user", "bot"]},
  {"value": "groups:write", "label": "jskit.connectors.slack.scopes.groupsWrite.label", "actors": ["user", "bot"]},
  {"value": "groups:write.invites", "label": "jskit.connectors.slack.scopes.groupsWriteInvites.label", "actors": ["user", "bot"]},
  {"value": "groups:write.topic", "label": "jskit.connectors.slack.scopes.groupsWriteTopic.label", "actors": ["user", "bot"]},
  {"value": "im:history", "label": "jskit.connectors.slack.scopes.imHistory.label", "actors": ["user", "bot"]},
  {"value": "im:read", "label": "jskit.connectors.slack.scopes.imRead.label", "actors": ["user", "bot"]},
  {"value": "im:write", "label": "jskit.connectors.slack.scopes.imWrite.label", "actors": ["user", "bot"]},
  {"value": "im:write.topic", "label": "jskit.connectors.slack.scopes.imWriteTopic.label", "actors": ["user", "bot"]},
  {"value": "lists:read", "label": "jskit.connectors.slack.scopes.listsRead.label", "actors": ["user", "bot"]},
  {"value": "lists:write", "label": "jskit.connectors.slack.scopes.listsWrite.label", "actors": ["user", "bot"]},
  {"value": "mpim:history", "label": "jskit.connectors.slack.scopes.mpimHistory.label", "actors": ["user", "bot"]},
  {"value": "mpim:read", "label": "jskit.connectors.slack.scopes.mpimRead.label", "actors": ["user", "bot"]},
  {"value": "mpim:write", "label": "jskit.connectors.slack.scopes.mpimWrite.label", "actors": ["user", "bot"]},
  {"value": "mpim:write.topic", "label": "jskit.connectors.slack.scopes.mpimWriteTopic.label", "actors": ["user", "bot"]},
  {"value": "pins:read", "label": "jskit.connectors.slack.scopes.pinsRead.label", "actors": ["user", "bot"]},
  {"value": "pins:write", "label": "jskit.connectors.slack.scopes.pinsWrite.label", "actors": ["user", "bot"]},
  {"value": "reactions:read", "label": "jskit.connectors.slack.scopes.reactionsRead.label", "actors": ["user", "bot"]},
  {"value": "reactions:write", "label": "jskit.connectors.slack.scopes.reactionsWrite.label", "actors": ["user", "bot"]},
  {"value": "reminders:read", "label": "jskit.connectors.slack.scopes.remindersRead.label", "actors": ["user"]},
  {"value": "reminders:write", "label": "jskit.connectors.slack.scopes.remindersWrite.label", "actors": ["user"]},
  {"value": "search:read.files", "label": "jskit.connectors.slack.scopes.searchReadFiles.label", "actors": ["user", "bot"]},
  {"value": "search:read.im", "label": "jskit.connectors.slack.scopes.searchReadIm.label", "actors": ["user"]},
  {"value": "search:read.mpim", "label": "jskit.connectors.slack.scopes.searchReadMpim.label", "actors": ["user"]},
  {"value": "search:read.private", "label": "jskit.connectors.slack.scopes.searchReadPrivate.label", "actors": ["user"]},
  {"value": "search:read.public", "label": "jskit.connectors.slack.scopes.searchReadPublic.label", "actors": ["user", "bot"]},
  {"value": "search:read.users", "label": "jskit.connectors.slack.scopes.searchReadUsers.label", "actors": ["user", "bot"]},
  {"value": "team:read", "label": "jskit.connectors.slack.scopes.teamRead.label", "actors": ["user", "bot"]},
  {"value": "usergroups:read", "label": "jskit.connectors.slack.scopes.usergroupsRead.label", "actors": ["user", "bot"]},
  {"value": "usergroups:write", "label": "jskit.connectors.slack.scopes.usergroupsWrite.label", "actors": ["user", "bot"]},
  {"value": "users:read", "label": "jskit.connectors.slack.scopes.usersRead.label", "actors": ["user", "bot"]},
  {"value": "users:read.email", "label": "jskit.connectors.slack.scopes.usersReadEmail.label", "actors": ["user", "bot"]},
  {"value": "users:write", "label": "jskit.connectors.slack.scopes.usersWrite.label", "actors": ["user", "bot"]},
  {"value": "users.profile:read", "label": "jskit.connectors.slack.scopes.usersProfileRead.label", "actors": ["user", "bot"]},
  {"value": "users.profile:write", "label": "jskit.connectors.slack.scopes.usersProfileWrite.label", "actors": ["user"]},
  {"value": "channels:join", "label": "jskit.connectors.slack.scopes.channelsJoin.label", "actors": ["bot"]},
  {"value": "channels:manage", "label": "jskit.connectors.slack.scopes.channelsManage.label", "actors": ["bot"]},
  {"value": "chat:write.customize", "label": "jskit.connectors.slack.scopes.chatWriteCustomize.label", "actors": ["bot"]},
  {"value": "chat:write.public", "label": "jskit.connectors.slack.scopes.chatWritePublic.label", "actors": ["bot"]},
  {"value": "metadata.message:read", "label": "jskit.connectors.slack.scopes.metadataMessageRead.label", "actors": ["bot"]}
];

const slackDefinition = Object.freeze({
  id: "slack", name: "Slack", description: "jskit.connectors.slack.description",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  scopes,
  scopesForSettings: ({ actor = "user" } = {}) => scopes.filter((scope) => scope.actors.includes(actor)),
  settingsSchema: createSchema({ signingSecretRef: { ...secretReference, required: false }, actor: { type: "string", enum: ["user", "bot"], defaultTo: "user" } }),
  settingsFields: [{ name: "signingSecretRef", label: "jskit.connectors.slack.fields.signingSecretRef.label", placeholder: "env:SLACK_SIGNING_SECRET", hint: "jskit.connectors.slack.fields.signingSecretRef.hint" }, { name: "actor", label: "jskit.connectors.slack.fields.actor.label", items: [
    { value: "user", title: "jskit.connectors.slack.fields.actor.items.user.title" }, { value: "bot", title: "jskit.connectors.slack.fields.actor.items.bot.title" }
  ], hint: "jskit.connectors.slack.fields.actor.hint" }],
  setup: {
    url: "https://docs.slack.dev/authentication/installing-with-oauth/",
    steps: [
      "Open Your Apps in the Slack developer site. Choose Create New App, From scratch, name it, and select the development workspace.",
      "Under OAuth & Permissions, add the exact HTTPS backend callback to Redirect URLs and save it.",
      "Add the selected permissions under User Token Scopes for Connected user, or Bot Token Scopes for Installed bot. Channel listing requires channels:read; history needs the matching channels/groups/im/mpim:history permission, profiles users:read and sending chat:write. Reconnect after changing permissions.",
      "Under Basic Information, copy Client ID and store Client Secret in the referenced Env variable. Also bind the HTTPS callback URL.",
      "Enable token rotation before new installations if you want expiring tokens. The runtime handles new rotating or non-rotating grants; it does not convert an existing grant to rotation.",
      "Use Manage Distribution for other workspaces. Workspace approval, Slack review and restricted scopes may require manual approval.",
      "For incoming events, copy Signing Secret from Basic Information → App Credentials into application Env. In Event Subscriptions, enable events, enter your application HTTPS event route and select required events. For buttons or views, enable Interactivity & Shortcuts and enter the application interaction route. These routes are separate from the OAuth callback; the app must implement them first.",
      "The application must verify signed raw request bytes, bind the Slack app/workspace, acknowledge promptly and deduplicate events before actions. Saving this form does not subscribe or deploy a callback. History reads one page of at most 15 messages; sends are not automatically retried. Invite bots to channels they need.",
      "Save configuration, then complete the application's separate consent flow. Installing a bot is not logging into the application as a Slack user."
    ]
  }
});
export { slackDefinition };
