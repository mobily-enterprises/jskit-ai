import { createSchema } from "json-rest-schema";
import { secretReference } from "@jskit-ai/connectors-core/shared/configuration";

const twilioDefinition = Object.freeze({
  id: "twilio", name: "Twilio", description: "Send SMS, initiate calls and read delivery/call status for the selected account and region.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  apiKeyReferenceLabel: "API key secret reference",
  settingsSchema: createSchema({
    authTokenRef: { ...secretReference, required: false },
    region: { type: "string", enum: ["us1", "ie1", "au1"], defaultTo: "us1" },
    accountSid: { type: "string", required: true, minLength: 34, maxLength: 34,
      validator: (value) => /^AC[0-9a-fA-F]{32}$/u.test(value) || "Enter an Account SID starting with AC followed by 32 hexadecimal characters." },
    apiKeySid: { type: "string", required: true, minLength: 34, maxLength: 34,
      validator: (value) => /^SK[0-9a-fA-F]{32}$/u.test(value) || "Enter an API Key SID starting with SK followed by 32 hexadecimal characters." }
  }),
  settingsFields: [
    { name: "authTokenRef", label: "Callback Auth Token reference (optional)", placeholder: "env:TWILIO_AUTH_TOKEN", hint: "For inbound messages, voice and delivery callbacks. Copy the account Auth Token from Twilio Console into private Env; this is NOT the API key secret." },
    { name: "region", label: "Region", hint: "Choose the region where this API key was created.", items: [
      { value: "us1", title: "United States (US1)" }, { value: "ie1", title: "Ireland (IE1)" }, { value: "au1", title: "Australia (AU1)" }
    ] },
    { name: "accountSid", label: "Account SID", placeholder: "AC followed by 32 hexadecimal characters", hint: "Copy the SID of the account or subaccount whose calls this app may read." },
    { name: "apiKeySid", label: "Standard API Key SID", placeholder: "SK followed by 32 hexadecimal characters", hint: "Copy the API Key SID for this account and region. Store its secret separately." }
  ],
  setup: {
    url: "https://www.twilio.com/docs/iam/api-keys/keys-in-console",
    steps: [
      "Select the intended account or subaccount in Twilio Console and copy its Account SID from the account dashboard.",
      "Open Settings, Account settings, API keys & auth tokens. Choose the region, then Create API key.",
      "Name the key, select Standard, and click Next. Copy its API Key SID into this form and store its secret in Env.",
      "Enter the secret's reference, select Got it! in Twilio, and finish key creation. Regional keys must match the region selected here.",
      "Save the configuration. The application runtime verifies access by reading call records without placing calls or sending messages.",
      "For sending, open Phone Numbers, Manage, Active numbers and select a number with SMS or Voice capability for your account. Alternatively, under Messaging, Services select your Messaging Service and configure its Sender Pool. The application chooses the authorized sender when sending.",
      "Trial accounts can contact only permitted verified recipients. Complete the sender registration and geographic permissions required for your destination, and check the product is available in your chosen region. Separate regional keys are not interchangeable.",
      "For incoming messages or calls, open the selected phone number's configuration. Set A message comes in or A call comes in to Webhook, enter the application's public HTTPS handler URL, choose HTTP POST, then save. For a Messaging Service, configure incoming-message handling in its Integration section.",
      "For callbacks, reveal the account Auth Token on the Console account dashboard and put it in private Env as TWILIO_AUTH_TOKEN. Enter env:TWILIO_AUTH_TOKEN above. It is different from the Standard API key secret. Your app must verify X-Twilio-Signature using the exact public callback URL before processing any incoming data.",
      "The generated app supplies StatusCallback for delivery or call completion and serves TwiML XML for inbound messages and call control. Changing your app's public domain requires updating these Twilio URLs. Callback signatures do not expire: the app must deduplicate events and prevent stale status updates.",
      "Disconnect removes only local connection state. To revoke the sending credential, delete the API key in Twilio. Remove or change webhook URLs separately; they remain configured at Twilio."
    ]
  }
});
export { twilioDefinition };
