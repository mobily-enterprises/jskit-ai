import { createSchema } from "json-rest-schema";
import { secretReference } from "@jskit-ai/connectors-core/shared/configuration";

const scopes = [
  {"value": "channels:history", "label": "View messages and other content in public channels you are in", "actors": ["user", "bot"], "recommended": true},
  {"value": "channels:read", "label": "View basic information about public channels in a workspace", "actors": ["user", "bot"], "recommended": true},
  {"value": "bookmarks:read", "label": "List bookmarks", "actors": ["user", "bot"]},
  {"value": "bookmarks:write", "label": "Create, edit, and remove bookmarks", "actors": ["user", "bot"]},
  {"value": "calls:read", "label": "View information about ongoing and past calls", "actors": ["user", "bot"]},
  {"value": "calls:write", "label": "Start and manage calls in a workspace", "actors": ["user", "bot"]},
  {"value": "canvases:read", "label": "Access contents of canvases created inside Slack.", "actors": ["user", "bot"]},
  {"value": "canvases:write", "label": "Create, edit and remove canvases", "actors": ["user", "bot"]},
  {"value": "channels:write", "label": "Manage a user's public channels and create new ones on a user's behalf", "actors": ["user"]},
  {"value": "channels:write.invites", "label": "Invite members to public channels", "actors": ["user", "bot"]},
  {"value": "channels:write.topic", "label": "Set the description of public channels", "actors": ["user", "bot"]},
  {"value": "chat:write", "label": "Send messages", "actors": ["user", "bot"]},
  {"value": "dnd:read", "label": "View Do Not Disturb settings for people in a workspace", "actors": ["user", "bot"]},
  {"value": "dnd:write", "label": "Edit a user's Do Not Disturb settings", "actors": ["user"]},
  {"value": "emoji:read", "label": "View custom emoji in a workspace", "actors": ["user", "bot"]},
  {"value": "files:read", "label": "View files shared in channels and conversations that your Slack app has been added to", "actors": ["user", "bot"]},
  {"value": "files:write", "label": "Upload, edit, and delete files as your Slack app", "actors": ["user", "bot"]},
  {"value": "groups:history", "label": "View messages and other content in private channels that your Slack app has been added to", "actors": ["user", "bot"]},
  {"value": "groups:read", "label": "View basic information about private channels that your Slack app has been added to", "actors": ["user", "bot"]},
  {"value": "groups:write", "label": "Manage private channels that your Slack app has been added to and create new ones", "actors": ["user", "bot"]},
  {"value": "groups:write.invites", "label": "Invite members to private channels", "actors": ["user", "bot"]},
  {"value": "groups:write.topic", "label": "Set the description of private channels", "actors": ["user", "bot"]},
  {"value": "im:history", "label": "View messages and other content in direct messages you are in", "actors": ["user", "bot"]},
  {"value": "im:read", "label": "View basic information about direct messages you are in", "actors": ["user", "bot"]},
  {"value": "im:write", "label": "Start direct messages with people", "actors": ["user", "bot"]},
  {"value": "im:write.topic", "label": "Set the description in direct messages", "actors": ["user", "bot"]},
  {"value": "lists:read", "label": "View Slack Lists", "actors": ["user", "bot"]},
  {"value": "lists:write", "label": "Create, edit, and delete Slack Lists", "actors": ["user", "bot"]},
  {"value": "mpim:history", "label": "View messages and other content in group direct messages that your Slack app has been added to", "actors": ["user", "bot"]},
  {"value": "mpim:read", "label": "View basic information about group direct messages that your Slack app has been added to", "actors": ["user", "bot"]},
  {"value": "mpim:write", "label": "Start group direct messages with people", "actors": ["user", "bot"]},
  {"value": "mpim:write.topic", "label": "Set the description in group direct messages", "actors": ["user", "bot"]},
  {"value": "pins:read", "label": "View pinned content in channels and conversations that your Slack app has been added to", "actors": ["user", "bot"]},
  {"value": "pins:write", "label": "Add and remove pinned messages and files", "actors": ["user", "bot"]},
  {"value": "reactions:read", "label": "View emoji reactions", "actors": ["user", "bot"]},
  {"value": "reactions:write", "label": "Add and edit emoji reactions", "actors": ["user", "bot"]},
  {"value": "reminders:read", "label": "View reminders created by your Slack app", "actors": ["user"]},
  {"value": "reminders:write", "label": "Add, remove, or mark reminders as complete", "actors": ["user"]},
  {"value": "search:read.files", "label": "Search a workspace's content in files", "actors": ["user", "bot"]},
  {"value": "search:read.im", "label": "Search a workspace's content in direct messages", "actors": ["user"]},
  {"value": "search:read.mpim", "label": "Search a workspace's content in group direct messages", "actors": ["user"]},
  {"value": "search:read.private", "label": "Search a workspace's content in private channels", "actors": ["user"]},
  {"value": "search:read.public", "label": "Search a workspace's content in public channels", "actors": ["user", "bot"]},
  {"value": "search:read.users", "label": "Search a workspace's users", "actors": ["user", "bot"]},
  {"value": "team:read", "label": "View the name, email domain, and icon for workspaces your Slack app is connected to", "actors": ["user", "bot"]},
  {"value": "usergroups:read", "label": "View user groups in a workspace", "actors": ["user", "bot"]},
  {"value": "usergroups:write", "label": "Create and manage user groups", "actors": ["user", "bot"]},
  {"value": "users:read", "label": "View people in a workspace", "actors": ["user", "bot"]},
  {"value": "users:read.email", "label": "View email addresses of people in a workspace", "actors": ["user", "bot"]},
  {"value": "users:write", "label": "Set presence for your Slack app", "actors": ["user", "bot"]},
  {"value": "users.profile:read", "label": "View profile details about people in a workspace", "actors": ["user", "bot"]},
  {"value": "users.profile:write", "label": "Edit a user's profile information and status", "actors": ["user"]},
  {"value": "channels:join", "label": "Join public channels in a workspace", "actors": ["bot"]},
  {"value": "channels:manage", "label": "Manage public channels that your Slack app has been added to and create new ones", "actors": ["bot"]},
  {"value": "chat:write.customize", "label": "Customize the content of messages sent by your Slack app", "actors": ["bot"]},
  {"value": "chat:write.public", "label": "Send messages to channels your Slack app isn't a member of", "actors": ["bot"]},
  {"value": "metadata.message:read", "label": "Allows your Slack app to read message metadata in channels that your Slack app has been added to", "actors": ["bot"]}
];

const slackDefinition = Object.freeze({
  id: "slack", name: "Slack", description: "Connect as a Slack user or install a bot to read conversations and send messages.",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  scopes,
  scopesForSettings: ({ actor = "user" } = {}) => scopes.filter((scope) => scope.actors.includes(actor)),
  settingsSchema: createSchema({ signingSecretRef: { ...secretReference, required: false }, actor: { type: "string", enum: ["user", "bot"], defaultTo: "user" } }),
  settingsFields: [{ name: "signingSecretRef", label: "Signing secret reference (optional)", placeholder: "env:SLACK_SIGNING_SECRET", hint: "For incoming events and interactions: Basic Information → App Credentials → Signing Secret. Keep the value in application Env, separate from Client Secret." }, { name: "actor", label: "Act in Slack as", items: [
    { value: "user", title: "Connected user" }, { value: "bot", title: "Installed bot" }
  ], hint: "User access acts as the person who connects. Bot access acts as the app in its installed workspace. Changing this choice removes permissions unavailable to that identity and requires reconnecting." }],
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
