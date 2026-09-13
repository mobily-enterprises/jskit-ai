const tiktokDefinition = Object.freeze({
  id: "tiktok", name: "TikTok", description: "Read a connected creator's profile and public video metadata.",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  clientIdLabel: "Client key", clientIdHint: "Use the Client key from TikTok's app credentials, not its App ID.",
  scopes: [
    { value: "user.info.basic", label: "Read basic profile information (required)", required: true, recommended: true },
    { value: "user.info.stats", label: "Read user statistics", recommended: true },
    { value: "user.info.profile", label: "Read extended profile information", recommended: true },
    { value: "video.list", label: "Read published video metadata", recommended: true }
  ],
  permissionsHint: "Basic profile access is required for verification. Users can decline the other permissions during consent; the corresponding operations then stay unavailable.",
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
