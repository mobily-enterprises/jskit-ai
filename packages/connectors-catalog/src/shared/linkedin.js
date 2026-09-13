const linkedinDefinition = Object.freeze({
  id: "linkedin", name: "LinkedIn", description: "Connect a member's LinkedIn account to read their permitted profile information and publish approved text posts.",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  scopes: [
    { value: "openid", label: "OpenID (required)", required: true, recommended: true },
    { value: "profile", label: "Read basic profile (required)", required: true, recommended: true },
    { value: "email", label: "Read primary email address" },
    { value: "w_member_social", label: "Publish posts" }
  ],
  permissionsHint: "OpenID and profile are required for profile verification. Email is optional. Publish posts needs LinkedIn's Share on LinkedIn product; select it and reconnect before publishing text posts.",
  setup: {
    url: "https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2",
    steps: [
      "Open https://www.linkedin.com/developers/apps, choose My apps > Create app, and supply the application name, LinkedIn Page, privacy-policy URL and logo. Complete the requested Page-owner verification. This registration belongs to your application.",
      "Open Products and request Sign In with LinkedIn using OpenID Connect. Wait until the product is available and Auth lists openid and profile. Email is optional. For text publishing, request Share on LinkedIn, wait until Auth lists w_member_social, select Publish posts here, save and reconnect.",
      "In Auth > OAuth 2.0 settings > Authorized redirect URLs, add the exact Suggested callback URL shown here. Use an absolute HTTPS URL without query or fragment. Copy Client ID from Auth into this form. Your application backend must implement the callback route.",
      "Save configuration, then choose Set credential in Env to store Client Secret as LINKEDIN_CLIENT_SECRET. Use Open Env to store the registered callback as LINKEDIN_CALLBACK_URL, or the alternate names you entered in the references. Return to this connection when both values are set.",
      "For shared or assistant access, choose Connect account and authorize the intended LinkedIn member. For Each user, connection starts from the generated application's account screen after signing in. Verification reads the member's profile; it does not publish or create an application login. Email may be absent even when requested.",
      "Your application must approve the exact post text and visibility (PUBLIC or CONNECTIONS) before posts.create. The adapter derives the author from the connected member; it cannot publish as an arbitrary person. A timeout may occur after a post was created: check LinkedIn before manually repeating it.",
      "LIMITATIONS: text posts only, with no image/video upload, organization posts, scheduling, post editing/deletion or analytics. Example: publish an approved announcement, but not a photo campaign. Saving this connection does not attach LinkedIn tools to Vibe64 coding chat.",
      "Reconnect repeats consent. Ordinary access expiry requires connecting again unless LinkedIn has enabled programmatic refresh for your registration and supplied a refresh token. Disconnect removes the local grant; remove provider access separately through LinkedIn's permitted-services settings. A new app registration or callback may require consent again."

    ]
  }
});

export { linkedinDefinition };
