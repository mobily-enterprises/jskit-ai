# Replicate

Import `replicateProvider` from `@jskit-ai/connectors-catalog/server/replicate`.
This adapter verifies the account and supports asynchronous model predictions.

## Configure access

1. Sign into Replicate and select the user or organization intended to own usage.
2. Open [API tokens](https://replicate.com/account/api-tokens). Create a token
   with a descriptive application name and copy it into backend Env as
   `REPLICATE_API_TOKEN`. The default account token also exists, but named tokens
   make subsequent replacement easier to track.
3. Save provider `replicate`, account mode `shared` or `assistant`, `scopes: []`,
   authentication
   `{ "method": "api-key", "secretRef": "env:REPLICATE_API_TOKEN" }`.
4. Run `connectApiKey`; inspect the returned account through `account.read` to
   check that it is the intended owner. To revoke a token, return to the token
   page and use its disable control. Local disconnect does not disable it at
   Replicate. [Token guide](https://replicate.com/docs/topics/security/api-tokens).

## Runtime and AI composition

`account.read` calls `GET https://api.replicate.com/v1/account`. It returns
the user/organization type and username, plus any optional profile fields.
`hardware.list` calls `GET https://api.replicate.com/v1/hardware`, returning
hardware names and SKU identifiers. Both use Bearer authorization and accept
no inputs. Listing hardware does not reserve it. Prediction operations are explicit; connecting does not generate output. Model/deployment creation is outside this adapter.
[HTTP reference](https://replicate.com/docs/reference/http/),
[provider schema](https://api.replicate.com/openapi.json).

Compose the [API-key pattern](../patterns/api-key-connection/PATTERN.md) with
this provider and the private JSON file store. The same configuration can be
written by hand, by an AI or through the editor. The application owns model-specific input validation, job lifecycle and spending.

## Automation and application ownership

The initial token creation path verified here is the web account page. An AI
can prepare the portable configuration and library wiring after that bootstrap;
no token-creation API was established in this pass. Replicate's API supports
additional model and prediction operations, but those are not verification steps.

The application owner supplies the Replicate account and token. Differently
named tokens in one account are not evidence of independent rate limits or
billing. The editor does not provision or allocate inference capacity.

Fixtures cover both requests, empty hardware lists, invalid responses, private
file-store restart, rotation, isolation and HTTP failures. No model was run.

## Prediction workflow

1. Open the model's API tab. Copy its owner/name and input fields. Call `models.get({owner,name})` to inspect `latest_version.openapi_schema` or use the pinned version's documented schema.
2. Invoke `models.predict({owner,name,input})` for an official model, or `predictions.create({version,input})` with its 64-character version ID (optionally `owner/name:version`). Inputs remain provider-shaped JSON, bounded to 256 KiB; use HTTP/data URLs for files. Never put the token into a file URL.
3. Save the returned ID under the authorized app user. Poll `predictions.get({id})` on your application's schedule. Starting/processing are pending; succeeded exposes output; failed exposes error; canceled is terminal. `predictions.cancel({id})` explicitly requests cancellation. Do not resubmit a timed-out creation automatically: its outcome may be unknown.
4. Output is preserved, including strings, arrays, structured JSON and image/audio/video URLs. The app renders the result and, when needed, saves files before the provider's retention window expires (normally one hour for API predictions). The adapter never fetches arbitrary result URLs.

For CLI or another framework, use the same project slot and Env reference with these documented HTTP endpoints and ownership checks. JSKIT invokes them through the existing connection service; no Vibe64 execution service is required.

**LIMITATIONS:** No media studio, background polling/history service, training, deployment administration, file uploader or editor-tool attachment. Example: an app can request a generated image and poll its ID, but must show progress and save/display the resulting image itself. Backend authorization must restrict prediction IDs to their initiating users; a shared provider token alone does not provide app-user isolation.

Sources: [HTTP operations](https://replicate.com/docs/reference/http), [prediction lifecycle](https://replicate.com/docs/topics/predictions/lifecycle), [retention](https://replicate.com/docs/reference/how-does-replicate-work). Fixtures exercise requests and result handling; no paid prediction or generated app was run.
