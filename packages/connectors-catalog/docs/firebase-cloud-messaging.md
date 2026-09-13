# Firebase Cloud Messaging

Import `firebaseCloudMessagingProvider` from
`@jskit-ai/connectors-catalog/server/firebase-cloud-messaging`.
The library validates and sends HTTP v1 messages using an explicitly supplied
service-account credential. Saving configuration does not contact Google.
Connecting performs a dry-run check; it does not deliver a notification.

## Set up the provider

1. In the [Firebase console](https://console.firebase.google.com/), open the
   project that will own the receiving installations. For a new project, choose
   **Create a project**, supply its name and complete the console's setup.
2. Open the gear beside **Project Overview**, then **Project settings**.
   Under **General**, copy **Project ID** into the form. This is the lowercase
   textual identifier, not the display name or numeric project number.
3. Open **Cloud Messaging**. Ensure **Firebase Cloud Messaging API (V1)** is
   enabled; use its linked Google Cloud API page to enable it if necessary.
4. Open **Service accounts**, then **Generate new private key** and
   **Generate key**. Store the complete downloaded JSON as a private server
   environment value, for example `FIREBASE_SERVICE_ACCOUNT`. The source file
   contains only `env:FIREBASE_SERVICE_ACCOUNT`.
5. For a dedicated sender identity, use Google Cloud **IAM & Admin > Service
   Accounts**. Create/select the account, then **Keys > Add key > Create new
   key > JSON > Create**. Give this identity **Firebase Cloud Messaging API
   Admin** on the target project, or an appropriate custom role. Organization
   policy can prevent key creation. Do not substitute an unrelated credential.
6. In Vibe64, enter `env:FIREBASE_SERVICE_ACCOUNT` in **Service-account JSON
   reference**, then **Save configuration**. Follow **Set credential in Env**
   and store the complete JSON under `FIREBASE_SERVICE_ACCOUNT`, not a filename
   or path. Return to the integration and connect. CLI applications supply the
   same environment value and call `connectServiceAccount` from their authorized
   server. Verification requests an access token and checks the target project
   with a validate-only topic message; no notification is delivered.
7. If verification fails, check the target project ID, enabled API and sender
   IAM grant. Disconnect removes the application's local connection; it does not
   delete the Google key. Rotate or delete keys under Google Cloud **IAM & Admin
   > Service Accounts > your sender > Keys**. Update Env when rotating.

Firebase documents the service-account setup, messaging scope and cross-project
sender permissions in its [HTTP v1 guide](https://firebase.google.com/docs/cloud-messaging/send/v1-api).
Google documents the console/API key lifecycle and organization restrictions
in [service-account key management](https://docs.cloud.google.com/iam/docs/keys-create-delete).

## Optional browser setup

Select **Include web push** to reveal three additional fields:

| Field | Console source | Exposure |
|---|---|---|
| Firebase API key | Project settings > General > Your apps > Web app > SDK setup and configuration: `apiKey` | Public |
| Firebase App ID | Same configuration: `appId` | Public |
| Web Push VAPID key | Project settings > Cloud Messaging > Web configuration > Web Push certificates | Public key only |

If there is no Web app, click the Web icon under **Your apps**, enter a nickname,
and choose **Register app**. Firebase Hosting is not required for another host.
Under **Web Push certificates**, choose **Generate Key Pair** when none exists,
then copy the public key. Keep these values in the same Firebase project.

The application still needs HTTPS, a service worker, notification permission and
browser registration. The current Firebase Web API uses `register` and
`onRegistered` to obtain installation IDs. Existing registration-token APIs are
deprecated but remain a supported target in this adapter. Do not mix both client
registration approaches in one app. See [Firebase Web setup](https://firebase.google.com/docs/cloud-messaging/web/get-started).

`firebaseCloudMessagingWebConfiguration(settings)` from
`@jskit-ai/connectors-catalog/client/firebase-cloud-messaging` returns
`{ firebaseConfig, vapidKey }`. It validates web mode, projects only public
fields and derives `messagingSenderId` as text from `appId`. It neither asks for
notification permission nor loads credentials. Use it with the Firebase SDK
version installed by the application, whose registration APIs must be verified.
Switching back to **Server or native only** removes the three web-only settings.

## Portable configuration

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "push": {
      "provider": "firebase-cloud-messaging",
      "displayName": "Application notifications",
      "accountMode": "shared",
      "scopes": ["https://www.googleapis.com/auth/firebase.messaging"],
      "authentication": {
        "method": "service-account",
        "secretRef": "env:FIREBASE_SERVICE_ACCOUNT"
      },
      "settings": {
        "projectId": "my-notifications-app",
        "clientMode": "server"
      }
    }
  }
}
```

For web push, use `clientMode: "web"` and add `apiKey`, `appId` and `vapidKey`.
The same schema validates files edited by hand, AI or Vibe64. It accepts
`shared` and explicitly authorized `assistant` ownership. This service account
does not represent a separate Google identity for every app user.

The target project setting is explicit even though the credential also contains
`project_id`: Google supports a sender service account in a different project.
IAM must grant that sender access to this target. Changing the target, settings,
scopes or secret reference requires verification again.

## Runtime and useful operations

The provider accepts JSON of type `service_account` with `project_id`,
`client_email`, `private_key`, `private_key_id`, and Google's fixed `token_uri`.
An optional `universe_domain` must be `googleapis.com`. It does not load external
account files, application-default credentials, metadata servers or delegated
user identities. `jose` signs an RS256 assertion with a one-hour lifetime; the
fixed Google token endpoint exchanges it for a short-lived access token.
[Google's service-account protocol](https://developers.google.com/identity/protocols/oauth2/service-account)

The shared core caches the token in the encrypted file store, renews under its
existing connection lock, resolves credential rotation before the next request,
and exposes only safe connection metadata. Raw service-account JSON is not
stored in the connection or sent to the FCM message endpoint.

| Operation | Input | Effect |
|---|---|---|
| `connection.check` | `{}` | Fixed topic/data payload with `validate_only: true` |
| `messages.validate` | `{ message }` | Validates the supplied message without delivery |
| `messages.send` | `{ message }` | Explicitly submits the supplied message for delivery |

`message` requires exactly one of `fid`, `token`, `topic`, or `condition`, plus
`notification` and/or `data`. Common notification fields are `title`, `body` and
an HTTPS `image` URL. Data values must be strings and keys cannot use Firebase's
reserved prefixes. The adapter bounds the serialized message to 4,096 UTF-8
bytes for individual targets or 2,048 for topics/conditions. It returns a
validated `{ name: "projects/.../messages/..." }` receipt; a receipt confirms
acceptance, not device delivery. No automatic retry or batch fan-out occurs.
[Message fields](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages),
[send and validate-only API](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send)

Example authorized call:

```js
await connections.invoke({
  context: trustedContext,
  integrationId: "push",
  operation: "messages.validate",
  input: { message: {
    fid: installationOwnedByTheRecipient,
    notification: { title: "Order ready", body: "Your order is ready." },
    data: { orderId: "42" }
  } }
});
```

The application's policy must authorize the audience and payload before a
`messages.send` action. A shared service credential grants no user permission
to send to arbitrary installations or topics. No login functionality is implied.

## Public, Online and custom domains

**Universal OAuth callback URL: not applicable.** Service-account authorization
is a server-to-server exchange, with no browser redirect to register. A VPS
address or custom domain does not change the target project or that exchange.
Browser notification permission, service workers and registrations belong to
the origin, so register the app on each new custom domain and update its stored
installation association. Existing cookies or browser permissions do not move
between unrelated domains.

The application owner supplies the Firebase project and sender credentials.
Online and installed-editor projects use the same configuration and runtime;
Vibe64 supplies no shared Firebase project or platform sender key. Two service
accounts or Web apps inside one project do not split its project quota.
[FCM quota ownership](https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas)

Keep sender private keys in the application's private Env or credential store.
The application backend authorizes notification requests and owns installation
associations. The same source schema remains available to CLI applications;
editing configuration does not provision a Firebase project or grant IAM access.

## Can AI automate the setup?

| Work | Feasibility and required authority |
|---|---|
| Create the application’s Cloud project | Resource Manager `projects.create`; organization policy, project limits and any required billing association still apply |
| Add Firebase and Web apps | Management API `projects.addFirebase`, `projects.webApps.create` and `projects.webApps.getConfig`; use an authorized management identity and inspect operation completion |
| Create a sender and key | IAM service-account creation and `projects.serviceAccounts.keys.create`; requires explicit administrative permission, and key creation may be prohibited |
| Configure target-project IAM | An administrator can grant the sender the required messaging permission; preserve unrelated IAM policy bindings |
| Web VAPID pair | Console workflow above; this implementation does not claim a verified automation API for it |
| Device/browser enrollment | Application SDK wiring and the user's notification permission remain necessary |

An AI can prepare calls and configuration when given authorized management
access; an FCM-only sending credential is insufficient for provisioning.
No provisioning calls run when saving or connecting this integration.
[Management API workflow](https://firebase.google.com/docs/projects/api/workflow_set-up-and-manage-project)

## Proof and remaining work

Controlled tests verify real JWT signatures with generated fixture keys, fixed
destinations, dry-run flags, target/input validation, malformed and denied
responses, file restart, renewal, rotation, ownership and interruption.
The browser form checks exercise source persistence and validation, not Google.
No live project, IAM setup, notification, browser subscription or generated app
has been exercised. The initial message fragment does not yet expose Android,
APNs or Webpush override objects, topic subscription administration, delivery
tracking or retry scheduling. Data-only iOS delivery can require APNs options
outside this initial fragment. These are explicit limits, not proven workflows.

## Client enrollment and expired recipients

The app owns the registration endpoint and storage. It may use ordinary files or
its own selected storage; this connector does not add a database to Vibe64. The
backend authenticates the current user, binds each FID/token to that user and
device, and updates a server timestamp. Do not accept an arbitrary user ID as
proof of ownership. Support multiple devices and remove the association on
logout/unsubscribe as appropriate. Store registrations privately.

For a Firebase Web SDK supporting the current FID APIs, compose your public
configuration helper with native SDK calls:

```js
// Application frontend: its installed Firebase SDK owns registration.
import { initializeApp } from "firebase/app";
import { getMessaging, onRegistered, register } from "firebase/messaging";
const messaging = getMessaging(initializeApp(firebaseConfig));
onRegistered(messaging, installationId => saveRegistrationForCurrentUser(installationId));
// Call from an explicit user action; create firebase-messaging-sw.js at the origin root.
if (await Notification.requestPermission() === "granted") {
  await register(messaging, { vapidKey });
}
```

`saveRegistrationForCurrentUser` is an authenticated application endpoint, not a
JSKIT export. Wire foreground `onMessage` and service-worker background handling
using the installed Firebase SDK; avoid duplicate notifications if the SDK
already displays a notification payload. Use HTTPS and feature detection, and
show permission-denied/unsupported states. Do not mix FID APIs with older
getToken-based registration in one app. Verify the SDK version exposes the
selected API. [Web enrollment](https://firebase.google.com/docs/cloud-messaging/web/get-started).

Native Android/Apple apps use their native Firebase SDK and registration-change
callbacks to upload the current identifier through the same app-owned endpoint.
Apple apps also need their APNs credential/configuration in Firebase and platform
notification entitlements; web VAPID does not configure Apple native delivery.
This provider's common notification/data fields do not expose platform-specific
APNs/Android overrides; use the native admin client for those advanced payloads.

`connector_recipient_unregistered` means a targeted FID/token received typed FCM
UNREGISTERED (404). Remove that recipient association; the sender connection
remains usable. A plain 404 is not enough to remove registrations.
`connector_message_invalid` means HTTP 400: fix/validate the payload before
concluding the target is invalid. Never clear all devices or revoke the service
account for one stale recipient. Other failures keep the existing denied/rate
limit/provider error behavior, with no automatic send retries.
[Registration lifecycle](https://firebase.google.com/docs/cloud-messaging/manage-tokens).

**LIMITATIONS:** Configuring the connector does not create a push opt-in UI,
service worker, device registry or coding-assistant attachment. For example, an
app can send an order-ready message after enrolling the customer's browser;
saving the Firebase fields alone does not enroll that browser. The application
owns those native SDK/UI pieces, delivery observation and any retry scheduling.
Other frameworks consume the same config/Env using native Google/Firebase tools;
JSKIT remains optional. No live browser subscription or notification was tested.
