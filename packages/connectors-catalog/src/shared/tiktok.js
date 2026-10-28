const tiktokDefinition = Object.freeze({
  id: "tiktok", name: "TikTok", description: "jskit.connectors.tiktok.description",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  clientIdLabel: "jskit.connectors.tiktok.clientIdLabel", clientIdHint: "jskit.connectors.tiktok.clientIdHint",
  scopes: [
    { value: "user.info.basic", label: "jskit.connectors.tiktok.scopes.userInfoBasic.label", required: true, recommended: true },
    { value: "user.info.stats", label: "jskit.connectors.tiktok.scopes.userInfoStats.label", recommended: true },
    { value: "user.info.profile", label: "jskit.connectors.tiktok.scopes.userInfoProfile.label", recommended: true },
    { value: "video.list", label: "jskit.connectors.tiktok.scopes.videoList.label", recommended: true }
  ],
  permissionsHint: "jskit.connectors.tiktok.permissionsHint",
  setup: { url: "https://developers.tiktok.com/docs/en/getting-started-create-an-app", steps: [
    "Sign into TikTok for Developers. Open your profile menu, choose Manage apps, then Connect an app and select its owner.",
    "Complete the app's basic information and Web platform settings. Add Login Kit and Display API in Products, then add the required permissions under Scopes.",
    "In Login Kit, configure Web and register the backend's exact HTTPS redirect URI. It must be static, contain no query or fragment, and be shorter than 512 characters.",
    "Copy Client key into this form. Store Client secret and the approved callback URL in the referenced backend Env variables; keep secrets out of browser and desktop bundles.",
    "Use Sandbox with designated test users during development. Complete URL ownership and app review requirements before production access.",
    "Saving only writes configuration. The application runtime performs consent, refresh and profile/video reads; posting, Research API and application login are separate work."
  ] }
});

export { tiktokDefinition };
