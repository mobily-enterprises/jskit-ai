import { createSchema } from "json-rest-schema";

const firebaseMessagingScope = "https://www.googleapis.com/auth/firebase.messaging";
const firebaseProjectId = { type: "string", required: true, noTrim: true, minLength: 6, maxLength: 30,
  validator: (value) => /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(value) || "Enter the Firebase project ID, without a URL or project number." };
const common = {
  projectId: firebaseProjectId,
  clientMode: { type: "string", enum: ["server", "web"], defaultTo: "server" }
};
const serverSettings = createSchema(common);
const webSettings = createSchema({ ...common,
  apiKey: { type: "string", required: true, noTrim: true, pattern: "^AIza[0-9A-Za-z_-]{35}$" },
  appId: { type: "string", required: true, noTrim: true, pattern: "^1:[1-9][0-9]{0,19}:web:[a-f0-9]{16,64}$" },
  vapidKey: { type: "string", required: true, noTrim: true,
    validator: (value) => /^B[A-Za-z0-9_-]{85}[AEIMQUYcgkosw048]$/u.test(value) || "Enter the public Web Push certificate key from Firebase, not a private key." }
});
const firebaseCloudMessagingDefinition = Object.freeze({
  id: "firebase-cloud-messaging", name: "Firebase Cloud Messaging", description: "jskit.connectors.firebaseCloudMessaging.description",
  accountModes: ["shared", "assistant"], authenticationMethods: ["service-account"],
  serviceAccountReferenceLabel: "jskit.connectors.firebaseCloudMessaging.serviceAccountReferenceLabel",
  serviceAccountReferenceHint: "jskit.connectors.firebaseCloudMessaging.serviceAccountReferenceHint",
  scopes: [{ value: firebaseMessagingScope, label: "jskit.connectors.firebaseCloudMessaging.scopes.firebaseMessagingScope.label", recommended: true }],
  permissionsHint: "jskit.connectors.firebaseCloudMessaging.permissionsHint",
  settingsSchema: (settings = {}) => settings.clientMode === "web" ? webSettings : serverSettings,
  settingsFields: [
    { name: "projectId", label: "jskit.connectors.firebaseCloudMessaging.fields.projectId.label", placeholder: "my-notifications-app", hint: "jskit.connectors.firebaseCloudMessaging.fields.projectId.hint" },
    { name: "clientMode", label: "jskit.connectors.firebaseCloudMessaging.fields.clientMode.label", items: [{ value: "server", title: "jskit.connectors.firebaseCloudMessaging.fields.clientMode.items.server.title" }, { value: "web", title: "jskit.connectors.firebaseCloudMessaging.fields.clientMode.items.web.title" }],
      hint: "jskit.connectors.firebaseCloudMessaging.fields.clientMode.hint" },
    { name: "apiKey", label: "jskit.connectors.firebaseCloudMessaging.fields.apiKey.label", placeholder: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", hint: "jskit.connectors.firebaseCloudMessaging.fields.apiKey.hint" },
    { name: "appId", label: "jskit.connectors.firebaseCloudMessaging.fields.appId.label", placeholder: "1:123456789012:web:abcdef1234567890", hint: "jskit.connectors.firebaseCloudMessaging.fields.appId.hint" },
    { name: "vapidKey", label: "jskit.connectors.firebaseCloudMessaging.fields.vapidKey.label", placeholder: "BEl62...", hint: "jskit.connectors.firebaseCloudMessaging.fields.vapidKey.hint" }
  ],
  setup: { url: "https://firebase.google.com/docs/cloud-messaging/send/v1-api", steps: [
    "Open the target Firebase project. In Project settings > General, copy its project ID. Enable Firebase Cloud Messaging API (HTTP v1) if disabled.",
    "In Project settings > Service accounts, click Generate new private key, then Generate key. Keep the complete downloaded JSON private. Alternatively use Google Cloud IAM & Admin > Service Accounts > your sender > Keys > Add key > Create new key > JSON; grant the sender Firebase Cloud Messaging API Admin on the target project. If your organization prohibits keys, ask its administrator; do not use an unrelated key.",
    "Enter the Firebase project ID and env:FIREBASE_SERVICE_ACCOUNT in Service-account JSON reference, then Save configuration. Follow Set credential in Env and store the complete downloaded JSON as FIREBASE_SERVICE_ACCOUNT, not its filename or path. Return here and choose Connect account / Verify again. Check connection only reads saved status. Verification makes a validate-only request; it does not deliver a notification.",
    "For web push, select Include web push. Under Project settings > General > Your apps, select your Web app, or click the Web icon and Register app with a nickname. Firebase Hosting is optional. From SDK setup and configuration, copy apiKey into Firebase API key and appId into Firebase App ID. These values are public.",
    "Open Project settings > Cloud Messaging > Web configuration > Web Push certificates. Generate or select a key pair and copy only its public key.",
    "The app must still register a service worker, request browser notification permission and associate installations with authorized app users. A new custom domain needs its own browser registration.",
    "The app must upload each registration to its authenticated backend with a timestamp and associate it with that user/device. On connector_recipient_unregistered, remove only that recipient association; on connector_message_invalid, check the payload first and do not blindly delete tokens. A send receipt is acceptance, not proof the device displayed a notification.",
    "Save again after changing web settings and verify the connection. For permission failures, check the enabled API, target project ID and sender IAM access. Disconnect removes the local connection, not the Google private key: rotate or delete that key in Google Cloud IAM > Service Accounts > your sender > Keys, and update Env when rotating. No browser OAuth callback or login feature is involved. Separate Firebase projects provide separate project quotas; service accounts in one project do not."
  ] }
});

export { firebaseCloudMessagingDefinition, firebaseMessagingScope, firebaseProjectId };
