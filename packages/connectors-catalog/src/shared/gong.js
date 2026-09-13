import { createSchema } from "json-rest-schema";

const gongDefinition = Object.freeze({
  id: "gong", name: "Gong", description: "Read company calls, transcripts, conversation statistics and linked CRM context.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  apiKeyReferenceLabel: "Access key secret reference",
  settingsSchema: createSchema({
    accessKey: { type: "string", required: true, minLength: 1, maxLength: 512,
      validator: (value) => !/[:\s\p{Cc}]/u.test(value) || "Enter the access key without spaces, control characters or colons." },
    apiBaseUrl: { type: "string", defaultTo: "https://api.gong.io", maxLength: 2048,
      validator: (value) => /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)?api\.gong\.io\/?$/u.test(value) ||
        "Use https://api.gong.io or your company's https://<company>.api.gong.io address, without a path or query." }
  }),
  settingsFields: [
    { name: "accessKey", label: "Access key", hint: "Copy the access key identifier from Gong's API settings. Store its secret separately." },
    { name: "apiBaseUrl", label: "API base URL (optional)", placeholder: "https://api.gong.io",
      hint: "Copy the API base URL from Gong's API settings. Leave empty to use https://api.gong.io." }
  ],
  setup: {
    url: "https://help.gong.io/docs/receive-access-to-the-api",
    steps: [
      "Sign into Gong as a technical administrator. Open Admin center, Settings, then API under Ecosystem.",
      "Click + Get API key. Enter Key name; TTL (days) and Trusted IPs are optional. For Trusted IPs, use the application backend’s outbound addresses. Click Get API key.",
      "Copy the identifier into Access key here. Enter env:GONG_ACCESS_SECRET in Access key secret reference and Save configuration. Choose Set credential in Env, paste the one-time secret as GONG_ACCESS_SECRET, and save there before closing Gong’s dialog with Done.",
      "If Gong provides a company API base URL, copy it here. Otherwise keep the default URL.",
      "Save configuration and choose Connect account. Your application verifies the company user list; this is a shared company credential, not individual user login. No OAuth app or callback is required.",
      "Call reads require existing recordings and appropriate company API access. Transcripts and analysis can be unavailable or still processing. Select call IDs or a date range in the app; its access policy must protect company recordings and CRM fields from unauthorized visitors.",
      "Linked deal context comes from the CRM data already connected to Gong; this does not configure CRM synchronization. Media URLs are requested only explicitly and expire after eight hours. The app must keep these URLs private and must never send the Gong Basic credential to a media URL.",
      "For a lost secret, create a replacement and update Env. Disconnect only removes local connection state. To revoke in Gong, open the key row’s actions, Edit, Delete, acknowledge I understand, then Delete API. Other systems using that key will lose access too."
    ]
  }
});
export { gongDefinition };
