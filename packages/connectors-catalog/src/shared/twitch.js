const twitchDefinition = Object.freeze({
  id: "twitch", name: "Twitch", description: "Connect Twitch accounts for stream discovery, chat, channel management, rewards, schedules and analytics.",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  scopes: [
    { value: "user:read:email", label: "Read your email address", recommended: true },
    { value: "channel:read:subscriptions", label: "Read your channel subscriptions" },
    { value: "moderator:read:followers", label: "Read followers for your channels" },
    { value: "user:write:chat", label: "Send chat messages" },
    { value: "user:read:follows", label: "Read the channels you follow", recommended: true },
    { value: "user:read:subscriptions", label: "Check your subscription status" },
    { value: "channel:read:vips", label: "Read VIPs for your channels" },
    { value: "channel:read:editors", label: "Read channel editors" },
    { value: "channel:read:polls", label: "Read channel polls" },
    { value: "channel:read:predictions", label: "Read channel predictions" },
    { value: "channel:read:redemptions", label: "Read channel point rewards and redemptions" },
    { value: "channel:read:hype_train", label: "Read current hype train status" },
    { value: "analytics:read:extensions", label: "Read extension analytics" },
    { value: "analytics:read:games", label: "Read game analytics" },
    { value: "bits:read", label: "Read Bits information" },
    { value: "moderator:read:chatters", label: "Read chatters in a channel" },
    { value: "moderation:read", label: "Read moderation data" },
    { value: "clips:edit", label: "Create clips" },
    { value: "channel:manage:broadcast", label: "Manage channel broadcast settings" },
    { value: "channel:manage:schedule", label: "Manage channel schedule" },
    { value: "channel:manage:polls", label: "Create and manage channel polls" },
    { value: "channel:manage:predictions", label: "Create and manage channel predictions" },
    { value: "channel:manage:redemptions", label: "Manage channel point rewards and redemptions" }
  ],
  setup: {
    url: "https://dev.twitch.tv/docs/authentication/register-app/",
    steps: [
      "Sign in to dev.twitch.tv/console with the account that will own the registration. Verify its email and enable two-factor authentication in Twitch Settings → Security and Privacy, then open Applications.",
      "Choose Register Your Application. Enter a unique name, add the exact callback URL shown for this project under OAuth Redirect URLs, choose the category and Confidential client type, complete any human verification, then choose Create.",
      "Use a separate Twitch registration for each independent application. An editor's client ID cannot automatically serve every app it creates.",
      "Open Manage for that application. Copy Client ID into this registration. Choose New Secret and save its value in the private Env variable referenced by Client Secret. A new secret invalidates the previous one; coordinate rotation before reconnecting.",
      "Keep the full callback URL in project Env and register the identical URL with Twitch. The generated app must serve that callback. After a domain change, update both places before connecting again.",
      "Select only the permissions your app needs. Profile email requires Read your email address; followed-channel reads require Read the channels you follow.",
      "Enable Send chat messages for outgoing chat; select the relevant Manage permission for broadcast settings, schedules, polls, predictions or rewards. Read permissions alone do not permit changes. Reconnect the account after adding permissions so the person can approve them.",
      "Twitch controls eligibility: some subscriptions, polls, predictions, rewards and non-recurring schedules require an eligible broadcaster. Analytics report only on games or extensions owned by the consenting account; an empty result can be valid.",
      "Rewards and redemptions remain tied to the Twitch application that created them. Replacing the Client ID does not transfer their management rights. Review recurring schedule changes carefully: updates or deletion can affect the whole series.",
      "Choose a shared connection for this project's common broadcaster, or individual connections so each app user consents to their own account. Saving the registration does not connect an account or sign users into your app.",
      "For live notifications, the generated app must maintain a Twitch EventSub WebSocket and subscribe using its welcome session ID. The app handles reconnection and duplicate events. This connector does not provide an editor-hosted event service or webhook transport.",
      "Wire token validation at application startup and at least hourly for maintained connections, including idle ones. The runtime also validates before every data call. Saving configuration does not start this task.",
      "Disconnect removes this app's stored connection. To revoke provider access, open Twitch Settings → Connections and disconnect the application there. A revoked grant needs consent again; keep Client Secrets and report download links out of public source and logs."
    ]
  }
});

export { twitchDefinition };
