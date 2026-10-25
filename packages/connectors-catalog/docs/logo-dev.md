# Logo.dev

Import `createLogoDevImageUrl` from
`@jskit-ai/connectors-catalog/client/logo-dev`. This is a library implementation
for public image URLs, usable in a browser or Node process. The shared catalogue
exports `logoDevDefinition` for configuration and UI metadata.

## Manual provider setup

1. Sign into [Logo.dev API Keys](https://www.logo.dev/dashboard/api-keys).
   Copy the publishable `pk_` key.
2. In the connection editor, add Logo.dev and enter `env:LOGO_DEV_PUBLISHABLE_KEY` in
   **Publishable key reference**. Choose **Save configuration**, then **Set
   credential in Env**, and store the actual `pk_` value as
   `LOGO_DEV_PUBLISHABLE_KEY`. Return after saving Env. The application resolves
   that one reference for its image rendering code.
3. For restrictions, turn on **Allowed Domains Only**, enter the domains that
   load images, one per line, then choose **Save Changes**.
4. Ensure image requests send an origin referrer. Include development/preview
   domains deliberately; restrictions also reject requests without a referrer.
5. Save the source configuration. Key rotation is documented as a support
   request; replace the environment binding after obtaining the new key.

Publishable keys work on the image CDN. Private `sk_` keys belong to other APIs
and must not appear in browser image URLs.
[Key types, restrictions and rotation](https://www.logo.dev/docs/platform/api-keys).

## Portable source and library usage

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "logos": {
      "provider": "logo-dev",
      "displayName": "Company logos",
      "accountMode": "shared",
      "scopes": [],
      "authentication": { "method": "api-key", "secretRef": "env:LOGO_DEV_PUBLISHABLE_KEY" }
    }
  }
}
```

An application build step, backend or CLI resolves this one configured reference
using its environment resolver. It then deliberately publishes the `pk_` value
as browser configuration or includes it in a returned image URL. Keep the
portable source file reference-only, exactly as the editor writes it. Do not
dump the environment or substitute a private key.

```js
import { createLogoDevImageUrl } from "@jskit-ai/connectors-catalog/client/logo-dev";

const imageUrl = createLogoDevImageUrl({
  publishableKey: publicConfiguration.logoDevKey,
  domain: "example.com",
  size: 128,
  theme: "dark",
  fallback: "404"
});
```

Assign this URL to an image element's `src`, supply meaningful `alt` text and
an origin-compatible referrer policy, and handle its `error` event with the
application's own fallback. `createLogoDevImageUrl` performs no HTTP request,
records no grant and cannot establish Connected. Its metadata explicitly marks
the runtime as `public-resource`; use the
[public-image source pattern](../patterns/public-image/PATTERN.md), not the
server connection-verification API. The browser's load/error events provide
delivery evidence. They are distinct from saving configuration.

The library validates an ASCII domain (including punycode), the publishable-key
prefix and image options, then returns a URL on `https://img.logo.dev`. It rejects
caller destinations, private keys, path/query injection and unsupported fields.
Inputs are not mutated. Local defaults are size 128, PNG, automatic theme,
greyscale off, retina off and monogram fallback. Options include JPG/WebP/SVG,
light/dark/auto themes, sizes 1–800, retina, greyscale and `404` fallback.
SVG availability depends on the provider plan; URL construction does not
confirm that entitlement. Width/height overrides, brand-name and crypto lookups are outside this function.
[Image parameters](https://www.logo.dev/docs/logo-images/get).

The provider can return a monogram with HTTP 200 when a brand logo is missing.
Use `fallback: "404"` when the application needs to distinguish missing images.
A URL or successful image load does not prove that a specific brand logo exists.
[Missing-logo behavior](https://www.logo.dev/docs/logo-images/introduction).

The key is intentionally visible in image requests. Apply the provider's
attribution and usage requirements in the product; the URL helper does not add
attribution or authorize image redistribution.
[Attribution](https://www.logo.dev/docs/platform/attribution),
[usage policy](https://www.logo.dev/docs/platform/fair-use).

## API provisioning and application ownership

No public account/key provisioning API was verified in the linked documentation.
An AI can prepare source configuration, rendering and domain instructions;
dashboard access and support-assisted rotation remain operator work. Do not
guess internal dashboard endpoints or use a secret key to make the image flow
look like an authenticated JSON service.

The application owner supplies its provider key and arranges the capacity it
needs. Configuration labels do not create independent quotas. Customer-owned
keys remain owned by the customer when exporting or moving an app. This image
flow creates no OAuth app, user login or per-user mailbox-style grant.

Allowed domains should identify the actual browser app: for example, its
hosting subdomain, custom domain and intended preview origin. The editor's VM
domain matters only if it itself loads the images. That differs from an OAuth
redirect allowlist. Changing application domains can require provider-side
restriction updates even though the portable reference is unchanged.

## Configuration-only contract

Logo.dev sets `configurationOnly`: an editor shows no account-connect controls,
and setup commands are refused before Env preparation or application execution.
Constructing an image URL never records Connected; image delivery is observed in
the browser.

## Lookup inputs

Supply exactly one of `domain`, `ticker` or `email` to the same URL helper.
`{ ticker: "SHEL.L" }` uses the provider's ticker endpoint with an exchange suffix;
`{ email: "person@example.com" }` extracts `example.com` locally and uses domain
lookup. The personal part of the email never enters the URL. These are ordinary
per-image application inputs, not project credential settings. The same source
pattern resolves the publishable key; other frameworks can construct equivalent
URLs without a Node runtime.
[Ticker endpoint](https://www.logo.dev/docs/logo-images/ticker).

**LIMITATIONS:** No private brand search/enrichment, crypto or ISIN lookup, avatar
identification or automatic attribution badge. Example: an address at gmail.com
returns the email provider logo, not the person's business. Apply plan attribution
in the app and distinguish image success from real brand-logo availability.
