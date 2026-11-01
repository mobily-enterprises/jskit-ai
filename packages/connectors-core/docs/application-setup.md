# Application setup in a hosted editor or CLI

Each project owns its configuration and connections independently. Hosted and
installed editors can edit the same configuration; neither supplies a default
shared provider registration, a token gateway or operator-funded API capacity.
JSKIT supplies JavaScript libraries. Other application frameworks implement their
own runtime and use their native tools.

## Inputs by connection type

| Type | Application developer or administrator supplies | Application runtime owns |
|---|---|---|
| OAuth user consent | Provider client ID, secret reference where required, callback reference, permissions | Callback route, attempts, account grants and refresh |
| OAuth client credentials | Confidential client ID, secret reference and service permissions | Token acquisition, verification and renewal; no browser callback |
| API key or service-account credential | Private environment binding or app-supported secret reference; resource settings | Credential resolution, provider check and authorized requests |
| Credential-free provider | Endpoint and supported non-secret settings | Requests and honest availability/error reporting |
| Browser resource | Public configuration and provider origin restrictions | Browser integration; private secrets remain server-side |
| Webhooks | App receiving endpoint, subscription settings and signing secret | Signature verification, event handling and subscription lifecycle |

Provider-specific fields and supported modes come from the provider definition.
A supported API-key mode does not imply OAuth support. Browser origins, webhook
URLs, sending-domain DNS and OAuth callbacks are different inputs. Each guide
must identify which apply and what changes when hosting or domains change.

## Source, environment and runtime state

- `integrations.json` contains non-secret settings and references. CLI users
  author it directly; an editor uses the same validation.
- Existing project Env facilities supply administrator keys and client secrets.
  Saving a reference does not prove its binding exists or has provider access.
- Individual users' provider grants live in application-owned private runtime
  storage. They are not shared environment variables.
- A shared connection serves app-authorized users of one application. Independent
  projects do not share live connections merely because they share an editor workspace.
- Applications choose their storage. The file-store option does not require a
  database; selecting SQL explicitly makes its migrations the application's job.

See [application-owned callbacks](oauth-callbacks.md) for OAuth setup and moves.

## Editor integration boundary

Configuration editing must work before an app runtime has been implemented.
Connection management requires an explicit application-owned setup operation
invoked through the editor's existing execution facilities. JSKIT's connection
service supplies reusable runtime methods; it does not implement that editor
transport or infer another framework's command.

The editor should display missing configuration or missing app setup honestly.
Only successful provider verification establishes a connected account. Status,
reconnect, cancellation and disconnect must use the same application owner and
environment as the original operation. Production management must use deployed
application code and state, not an arbitrary editing session.

The complete editor setup journey remains work in progress. Focused protocol
fixtures are evidence for library behavior, not live provider consent or a
complete generated application's functionality.
