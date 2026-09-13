import { createSchema } from "json-rest-schema";

const common = {
  loginCustomerId: { type: "string", noTrim: true, minLength: 10, maxLength: 10,
    validator: (value) => /^[0-9]{10}$/u.test(value) || "Enter the manager's 10-digit customer ID without hyphens." }
};
const googleAdsDefinition = Object.freeze({
  id: "google-ads", name: "Google Ads", description: "Discover advertising accounts, prepare reviewed Search campaigns and read Google Ads reports.",
  categories: ["Google", "Marketing"], accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  settingsSchema: createSchema(common),
  settingsFields: [
    { name: "loginCustomerId", label: "Manager customer ID (optional)", placeholder: "1234567890",
      hint: "Use the manager through which this app accesses client accounts, without hyphens. Direct account access can leave this blank." }
  ],
  scopes: [{ value: "https://www.googleapis.com/auth/adwords", label: "Access Google Ads accounts", recommended: true }],
  permissionsHint: "This Google permission can authorize campaign changes. Search management uses separate reviewed operations; your application must authorize each account and spending decision. This is not application login.",
  setup: { url: "https://developers.google.com/google-ads/api/docs/get-started/make-first-call", steps: [
    "Select your Google Cloud project, open APIs & Services > Library and enable Google Ads API. Open its Overview page and review API access level. Test access only permits test accounts; use Upgrade access level to apply for production access.",
    "In Google Auth Platform, configure Branding and Audience, adding test users while testing. In Data Access add https://www.googleapis.com/auth/adwords. Complete the applicable consent publishing and verification requirements.",
    "Open Clients, create a Web application client and add this project's exact Suggested callback URL to Authorized redirect URIs. Your application backend must implement that callback.",
    "Copy Client ID here and Save configuration. Use Set credential in Env to save the client secret under its referenced key, and save the same callback URL under the callback reference. Google Ads no longer requires a developer token.",
    "If access goes through a manager, enter its 10-digit customer ID without hyphens. Leave it blank for direct access. The person consenting must already have access to the intended Ads accounts.",
    "For Search campaigns, save and connect this shared account, then open Google Ads Search campaigns below. Load the client account and website goal, prepare and save the plan, validate it, and explicitly create it paused. Verify tags, billing and advertiser requirements before the separate launch approval. Disconnecting does not pause running ads.",
    "Choose Connect account for a shared project account. Individual users connect inside the application's own account screen. Verification lists directly accessible accounts; it does not prove access to every child account. Disconnect removes local access; revoke Google consent separately when intended."
  ] }
});

export { googleAdsDefinition };
