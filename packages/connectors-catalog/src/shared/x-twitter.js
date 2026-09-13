const xTwitterDefinition = Object.freeze({
  id: "x-twitter", name: "X (Twitter)", description: "Read public X profiles, posts and recent search with an application's bearer token.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  apiKeyReferenceLabel: "App-only bearer token reference",
  verificationFields: [{ name: "username", required: true, label: "Verification username",
    hint: "Enter a public X username without @. Connecting looks up this profile and can consume provider credits." }],
  apiKeyReferenceHint: "Reference the app-only Bearer Token from X Developer Console. This token does not sign in an app user.",
  setup: { url: "https://docs.x.com/x-api/getting-started/getting-access", steps: [
    "Sign into console.x.com, complete developer onboarding and choose New App. Enter the application's name, description and use case.",
    "Open the app's credentials and copy its app-only Bearer Token into backend Env. Save only that Env reference here, without the Bearer prefix.",
    "Check API access, available credits and spending limits in Developer Console. Verification and public-data reads can consume provider credits.",
    "Save configuration, then call connectApiKey with verificationInput containing a real public username, without @. Verification looks up that profile.",
    "Recent search covers the last seven days. Use provider query operators for filters and request more pages explicitly; each read can consume credits. Your app owns attribution, display and query access.",
    "Disconnect removes the local connection only. Replace the token in backend Env and verify again to rotate it; invalidating the provider token affects every app using that token.",
    "This flow has no OAuth callback or per-user consent. It cannot post, read direct messages or provide application login."
  ] }
});

export { xTwitterDefinition };
