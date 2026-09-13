# Google registrations, configuration and lifecycle

Documentation checked: 12 September 2026. These console steps follow public
Google documentation; this implementation does not claim signed-in console or
live-consent verification. Provider tests use simulated HTTP and real temporary
JSON connection files.

## Shared inputs

| Input | Portable configuration / owner |
|---|---|
| Display name | `integrations.<slot>.displayName` |
| Account use | `accountMode`: shared, per-user or assistant; application policy enforces it |
| Requested permissions | `scopes`: exact provider scope strings; read defaults are selected |
| App registration | `authentication.registrationRef`, pointing into `registrations` |
| Client ID | Registration `clientId`, public web-client identifier |
| Client secret | Private environment or secret store; registration contains `clientSecretRef` |
| Callback URL | Full backend route in a private binding referenced by `callbackUrlRef` |
| People/project access | Application-owned membership and explicit grants, checked before use |

Choosing extra scopes does not install additional business operations. Google
add-on scopes require an actual add-on context. A Gmail connection is not a
Google login session for the application; keep login and API grants distinct.

## Manual own-registration setup

1. Sign in to [Google Cloud Console](https://console.cloud.google.com/) using an
   account authorized to create or administer the application's project.
2. Use the project selector to choose an existing project, or **New Project**
   to create one. Record its project ID and quota/billing owner. Choose the
   organization/location required by the operator's account.
3. Open **APIs & Services → Library**, find the API named in the provider's
   guide, and select **Enable**. Enable only APIs required by the app's feature.
4. Open **Google Auth Platform → Branding**. Enter the public app name, support
   email and developer contact. Supply the home page, privacy policy, terms and
   authorized domains required for that application's intended audience.
5. In **Audience**, choose Internal only for an eligible Workspace organization
   whose users are the intended audience. Otherwise choose External. While the
   app is in testing, add the Google accounts that will test the connection via
   **Audience → Test users → Add users**, then Save. External Testing refresh
   tokens for these API scopes expire after seven days; reconnect as needed
   during testing. See [refresh-token expiry](https://developers.google.com/identity/protocols/oauth2#expiration).
6. In **Data Access**, add the provider guide's recommended read scope. Add more
   only for operations the app actually implements. Sensitive/restricted scope
   review depends on the scope and app distribution; follow Google's current
   [verification requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).
7. In **Clients**, choose **Create client**, type **Web application**, and give
   it an environment-specific name. This library implements confidential web
   clients, including a backend used by a local editor.
8. Under authorized redirect URIs, add the **exact backend callback URL**, with
   scheme, host, port when applicable and path. For a local CLI, a registered
   `http://127.0.0.1:<port>/<callback-path>` is supported. HTTPS is required for
   remote callbacks. Do not use wildcard VM/project/custom-domain URLs.
9. Create the client. Copy the Client ID into the registration's `clientId`.
   Copy or download the secret immediately; it is shown only at creation.
   Store the secret privately and set `clientSecretRef`, for example
   `env:GOOGLE_CLIENT_SECRET`. Store the full callback URL under the variable
   referenced by `callbackUrlRef`. Never put the secret itself into the JSON.
10. Save `integrations.json`. A CLI uses the same parser and validator as the
    form. Use encrypted file storage for grants/attempts outside source; there
    is no database requirement.
11. The application's trusted owner policy authorizes `beginAuthorization`.
    For Sheets/Docs/Slides, include the resource ID in `verificationInput` as
    documented below. Display/open the returned URL in a normal browser.
12. Recover the initiating authenticated context at the callback and call
    `completeAuthorization` with the full returned callback URL. The library
    checks state, PKCE, identity, registration, expiry, granted scopes and a
    provider read before saving Connected. A denied, expired or repeated
    callback never creates a successful grant.
13. Use the named operations from the provider guide. Page tokens and results
    remain provider data; your application controls caching and presentation.
14. To replace a lost secret or rotate it, open **Clients**, select the client
    and choose **Add Secret**. Update the private binding, verify operation,
    then disable the old secret. See [Google client administration](https://support.google.com/cloud/answer/15549257?hl=en). Replacing the Client ID requires reconnecting. Revoking access
    from the Google account affects that provider grant; local disconnect
    removes only the application's stored connection and pending attempts.

## Application and environment boundaries

Each application owns its Google registration, credentials and callback route.
The same setup applies from a CLI, an installed editor or a hosted editor. There
is no shared editor registration or universal callback. Set `source` to `own`;
store the secret in the application's environment and only its reference in JSON.

Use the provider registration that belongs to the application and its intended
audience. Development and production bindings must resolve to their explicitly
registered callbacks. When a callback domain changes, update the provider
registration and environment binding, then reconnect under the new configuration.
See the [callback guide](../../connectors-core/docs/oauth-callbacks.md).

The Google Cloud project owns project quotas and billing. Two clients inside
one Cloud project do not isolate its project quota. Each independent application's
operator chooses its Cloud project; editor subscription level does not assign
provider capacity or transfer user grants.

## What an AI can automate

Classification: **assisted API/CLI provisioning**. With authorized Google Cloud
credentials and sufficient project/organization permissions, an operator can
use `gcloud projects describe <id>` to check for an existing project and
`gcloud projects create <id> --name=<name>` when it is absent. Enable the exact
API with `gcloud services enable <service-name> --project=<id>`; this is a
repeatable operation. See [project creation](https://cloud.google.com/resource-manager/docs/creating-managing-projects)
and [Service Usage enablement](https://cloud.google.com/service-usage/docs/enable-disable).

The agent can prepare environment names, JSON references, callback URI lists,
scope selections and implementation wiring. The established API for managing
projects is not proof of an API for creating arbitrary Google OAuth web
clients. This implementation documents client creation and consent branding in
the console, without inventing an OAuth client-creation endpoint. Billing,
domain ownership, audience decisions, provider review and user consent require
the relevant operator/account authority.

## Failure and operation limits

A 401 or invalid refresh grant requires reconnecting. A 403 indicates missing
scope, provider policy or resource permission; check each rather than silently
requesting broad permissions. A 429 reports provider limits. Refresh tokens
are updated under the same connection lock. Removing a configured permission
blocks operations that depended on it even if an older token had that grant.

No provider calls, sample-app generation or deployment are required by this
iteration's automated test scope. Real account access remains future acceptance.
