# Google Analytics

## Delivery target and current implementation

This connector configures website tracking with an application-owned GA4
Measurement ID. The definition and editor now accept the public setting without a connection
command. Controlled shared-form, dashboard and chat checks pass. Generated-application
wiring and live traffic are not exercised.
Saving this configuration is not evidence that tracking is installed.

## Get the application's Measurement ID

1. Open [Google Analytics](https://analytics.google.com/) and select the
   application's Analytics property. Create a property and a Web data stream if
   the application does not have one yet.
2. Open **Admin → Data collection and modification → Data streams** and select
   that web stream. Use the application's published website address when setting
   up the stream.
3. Copy the **Measurement ID** from **Stream details**. For this GA4 website
   configuration, use the stream's `G-` identifier.
4. Save that public identifier in the integration's Measurement ID field. It is
   intended to appear in the published website; it is not an API key or proof
   that the editor owns the Analytics property.
5. Have the application's framework install the Google tag using that setting.
   Check the application's existing tag manager first to avoid installing it
   twice. The application controls when tracking loads and its consent behavior.

Google's [ID instructions](https://support.google.com/analytics/answer/9539598?hl=en)
and [tag installation instructions](https://support.google.com/analytics/answer/15756615?hl=en-GB)
are the provider references. This flow does not require a Google OAuth client,
client secret, callback URL, or Vibe64-owned Google registration.

## Configuration and ownership contract to implement

The intended `integrations.json` slot is:

```json
{
  "schemaVersion": 1,
  "integrations": {
    "website-analytics": {
      "provider": "google-analytics",
      "displayName": "Website analytics",
      "accountMode": "shared",
      "scopes": [],
      "authentication": { "method": "none" },
      "settings": { "measurementId": "G-XXXXXXXXXX" }
    }
  },
  "registrations": {}
}
```

The shared field component and CLI validator use this same format. The public ID can live directly in the text configuration; a
framework can expose it through its normal public build configuration. No
secret-resolution service is needed.

Vibe64 Public owns the editor experience. Online uses that same experience and
the selected project's configuration. Saving must report **Configured**, with
an explanation that application wiring and event delivery are separate. It must
not start OAuth, call a connection-status command, send a test tracking event,
or show an account as verified. Changing or removing the setting is an ordinary
configuration change; it does not revoke a Google account.

JSKIT owns the JavaScript definition, validation, shared form and usage guidance.
The generated application owns loading the tag, navigation/page-view handling,
consent behavior, and the lifecycle of its deployed configuration. Laravel uses
its own layout, asset and configuration tools; it does not need JSKIT at runtime.
An assistant can wire either framework from the saved public setting. Creating
or selecting the actual Analytics property requires the owner's access; saving
this ID does not authorize Admin API calls to do that automatically.

## Framework handoff

The assistant should inspect the application's selected framework and existing
tracking before editing code. It receives the slot name, not a copied credential.
Use these steps for the saved `website-analytics` example:

1. Read and validate the application's own `integrations.json` during its normal
   configuration loading or build. Select
   `integrations["website-analytics"].settings.measurementId`. A missing slot
   means tracking is disabled; do not silently substitute another property's ID.
2. Expose only this public ID to the frontend. Never serialize the whole
   integrations file or registrations into HTML or a browser bundle.
3. Wire the ID into the existing Google tag or tag-manager installation. If none
   exists, use Google's documented tag installation through the framework's
   normal document/layout entry point. Preserve consent controls and avoid a
   second installation or duplicate navigation events.
4. Treat removal as disabling this application's tag configuration on the next
   application reload/build/deployment, according to its normal configuration
   lifecycle. It does not delete the Analytics property or historical data.
   An already-loaded page may need reloading; removing a file entry does not
   reach into running browsers and undo previously sent events.
5. Keep controlled tests local: mock the tag boundary and verify the selected ID,
   consent gating, missing-slot behavior, and no duplicate initialization. Do not
   send real Analytics events merely to prove that configuration saves.

For Node/JSKIT, import `googleAnalyticsDefinition` from
`@jskit-ai/connectors-catalog/shared` and validate using
`validateIntegrationConfiguration` from
`@jskit-ai/connectors-core/shared/configuration`, registering that definition.
The framework still owns document rendering, public configuration and navigation.
No connection service or token store is required for this provider.

For Laravel, read the same project-owned JSON through the application's normal
configuration/bootstrap code and expose the selected public ID to its Blade or
frontend entry point. If configuration is cached or assets are built, incorporate
changes through that existing lifecycle. Use Laravel-native validation and
rendering; do not install JSKIT or a JavaScript connection daemon just to read
this setting. Escape any value rendered into HTML or JavaScript with the
framework's normal safe serialization.

These are implementation instructions. They do not claim that a generated
application, consent implementation or live Analytics delivery has been tested.

## Delivery checklist

- [x] Replace the unpublished OAuth definition with the public Measurement ID
  field and no-credential, shared configuration.
- [x] Make the editor distinguish configured settings from verified accounts,
  including its automatic status checks and assistant setup request.
- [x] Remove the mismatched Admin reader and its direct package references,
  tests and provider instructions without a compatibility alias.
- [x] Verify UI/CLI round-trip, invalid input, persistence and removal using
  controlled fixtures. Prove configuration does not initiate provider requests.
- [x] Provide the framework setup instructions without claiming a generated
  application or live Analytics traffic has been tested.

For this pre-release migration, existing Admin-reader users must explicitly
remove or replace that integration. An OAuth registration cannot be converted to
a Measurement ID. Remove its Env secrets only after checking no other slot uses
them; revoke any old grant through the existing application before removing its
runtime. Framework-native Admin API use remains a separate application concern.


## Optional JavaScript browser helper

Import `createGoogleAnalytics` from
`@jskit-ai/connectors-catalog/client/google-analytics` after browser hydration.
It owns one Measurement ID per page and loads the Google tag only after explicit
consent. Reusing the same instance/ID does not insert another script or config.
If the app already has a Google tag or Tag Manager, use that existing owner;
the helper refuses a competing installation. It does not build a consent banner.

```js
import { createGoogleAnalytics } from '@jskit-ai/connectors-catalog/client/google-analytics';
// Expose just this public field from the selected validated integration slot.
const analytics = createGoogleAnalytics({ measurementId: publicSettings.measurementId });
function consentChanged(allowed) {
  analytics.setConsent(allowed);
  if (allowed) analytics.pageView({ location: location.origin + location.pathname, title: document.title });
}
// Call from your framework's completed navigation hook, using redacted URLs.
function routeChanged(publicUrl, title) {
  analytics.pageView({ location: publicUrl, title });
}
// Call once when the app has confirmed the business event, not on every render.
function bookingCompleted() { analytics.event('generate_lead'); }
// On app teardown/removal: unsubscribe the app's route/consent hooks, then:
// analytics.dispose();
```

Before consent, no tag loads and events return false. Consent withdrawal sets
Google's per-property disable flag and stops this helper's events; it does not
delete existing cookies or erase events already sent. The app's consent manager
owns that policy. This is basic consent-gated loading, not an implementation of
advanced Consent Mode or advertising consent. Script blockers/network/CSP can
prevent delivery even after enabling; no Connected/verified claim is made.

For manual SPA page views, open the GA4 web stream's Enhanced measurement
settings, Page views, Show advanced settings, and disable **Page changes based
on browser history events**. The helper already sends `send_page_view: false`;
that alone does not disable Enhanced Measurement's independent history listener.
Use exactly one navigation hook. Repeated consecutive views of the same URL are
suppressed; navigating away and back produces another view.

For a conversion, emit a suitable recommended event such as `generate_lead` or
`purchase` only when the app confirms that action. In Analytics **Admin → Data
display → Events**, mark the event as a key event (create the named event there
if it has not arrived yet). Google Ads conversion import is separate. The helper
does not enforce paid entitlements, deduplicate business transactions or confirm
that Google received an event. Do not include emails, message text, sensitive
query parameters or other personal data in events or page URLs.

Disposal disables this ID and removes the inserted script element. Loaded
Google code cannot be unloaded and prior events cannot be recalled. Reload the
page to change properties or reinitialize after disposal. Removing the JSON slot
must also remove its wiring on the app's next configuration/build/deploy cycle.
A missing slot must not instantiate a tracker.

Other frameworks use their existing tag/Tag Manager support and native consent
and route hooks with the same public ID. They do not need the JavaScript helper
or a Node daemon. The app/framework remains the tracking owner; Vibe64 only edits
configuration and supplies guidance. See Google's
[manual page views](https://developers.google.com/analytics/devguides/collection/ga4/views)
and [disable flag](https://developers.google.com/tag-platform/security/guides/privacy).

**LIMITATIONS:** no reporting/Admin API, property provisioning, consent banner,
advanced Consent Mode, Ads conversion import or live delivery verification.
Example: a configured booking app can send a consented page view and generate_lead;
the owner still marks that event as a key event in Analytics and the framework
wires navigation/consent. Existing tag installations use their existing tools.
