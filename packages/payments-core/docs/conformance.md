# Portable payment examples and conformance

`contracts/conformance.json` is ordinary JSON, also exported as
`@jskit-ai/payments-core/conformance.json`. Read the file as data; no Node process,
JSKIT import, editor service or project tool is necessary to interpret it.
It accompanies the draft-07 configuration schema and the semantic contract.
These are test examples, not a production workflow interpreter.

## Configuration examples

Each `configurationCases` entry supplies a complete payment-relevant document
and two expected booleans:

- `schemaValid`: validate `document.extensions.payments` against
  `configuration.schema.json` using a draft-07 validator, without coercing values,
  injecting defaults or removing unknown properties.
- `configurationValid`: after that validation, apply the connection references
  below. This does not replace full integration-document validation.

For each named payment environment:

1. Resolve `integrationId` from `document.integrations`; absence fails.
2. Require provider `stripe` or `paddle`, `accountMode` equal to `shared`, and
   `authentication.method` equal to `api-key`.
3. Require `authentication.secretRef` to match `env:[A-Z_][A-Z0-9_]*` in its
   entirety. This describes a reference; never read or copy a real secret into
   the test fixture or source configuration.
4. For Paddle, require the integration's `settings.environment` to equal the
   payment environment, and require `taxCategory` and `publicClientTokenRef` in
   the payment binding. Their values already passed the payment schema.
5. With `topUps`, refuse every environment bound to a Paddle integration (top-ups
   are Stripe Checkout payments), and refuse a `minimumAmount` above
   `maximumAmount`.

The examples distinguish malformed prices/credits/features and inline secrets
from structurally valid but unresolved or mismatched merchant connections.
The fixture credentials are references only. Passing validation does not prove
that an Env value exists, that a merchant owns a key, or that it can take payments.
Resolve and verify those resources separately at application setup.

## Account behavior sequence

`accountScenario` supplies the payment-relevant configuration, merchant and
subject scope, initial UTC clock in milliseconds, and a provider customer to
bind to that subject. Start with a fresh transactional fixture database. Process
`steps` in order without contacting a provider:

- `clock` replaces the test clock for that and later steps.
- `subjectId` selects another subject for that step only. Otherwise use the
  scenario's subject. This models trusted app composition, not a public request.
- `operation` names the semantic operation in the contract. Map it explicitly
  to the framework's service in the test; do not expose dynamic method invocation
  as an app endpoint.
- `input` is the operation input. For `reconcileEvent`, `facts` is the current
  provider snapshot returned by the controlled loader after customer binding.
  Raw webhook authentication is tested separately; these facts are not an
  unsigned webhook payload to accept in production.
- `expect` asserts every listed field recursively. Arrays and primitive values
  must match exactly. Unlisted result fields are permitted; extra array entries
  are not. `error` instead requires that semantic error code and a rolled-back
  operation, preserving state for later steps.

The sequence covers initial paid renewal, duplicate delivery, another delivery
for the same invoice, stable debit references, mismatched retry input, isolation
from another tenant, expiry exactly at period end, expired refunds, promotional
credits and rejection of overspending. Credit expiry and feature access are
separate assertions. An expired allowance never becomes a fresh grant on retry.

## Top-up sequence

`topUpScenario` supplies a configuration with `topUps`, a merchant and subject
scope, and `steps` run in order against a fresh database, with a controlled
provider in place of Stripe:

- `topUp` starts a top-up for the step's subject (`subjectId`, else the
  scenario's) with `input` (`amount`, `requestId`), authorized by that subject.
  `topUp` names it for later steps. The controlled provider answers each new
  Checkout session with an id of its own.
- `settle` reports `facts` (`outcome`, `amount`, `currency`) for the named
  top-up's session through `door`: `webhook` as a verified provider event,
  `return` as the return page's confirmation, for which the server reads those
  facts from the provider. Both doors settle through the same operation.
- `credits` lists every credit the application's credit function received, in
  order, as `subjectId`, `amount` and `currency`.

`expect` and `error` work as in the account sequence. The sequence covers the
amount limits, a repeated request and a conflicting one, an unpaid return, a
bank payment still processing, a paid amount that differs from the top-up's
(refused, nothing credited), the return and the webhook reporting one payment
(credited once), a late failure after payment, another subject's top-up with the
same request id, and failed and expired top-ups that a later report never moves.

## Framework and CLI ownership

A Laravel application uses its own JSON parser/validator, policies, models,
transactions and test tools to implement these cases. An assistant can translate
the sequence into that app's PHPUnit/Pest tests without installing this JavaScript
runtime. The application selects its billable model and schema; the fixture does
not prescribe table names or copy JSKIT's storage internals into another framework.

A Node CLI consumer can run the same semantic calls against its installed JSKIT
services. Project tooling may describe the project's test command, but these
fixtures do not require it to execute. A hosted editor's configuration must
preserve these same values rather than inventing a different hosted payment format.

## Evidence boundaries

The package's `test/conformance.test.js` checks all configuration examples, the
full account sequence and the top-up sequence against the actual JSKIT service
and SQLite storage. An independent Python draft-07 validator plus the explicit
reference rules also checked the first 11 configuration examples without
importing Node or JSKIT; the five top-up examples added later have been checked
by the JSKIT test only. This establishes independent interpretation of
configuration, not a PHP payment engine.

Native Laravel execution, cross-process MySQL/PostgreSQL transactions, raw webhook
delivery and real provider checkout are separate evidence. These examples do not
certify them. The editor management-command conformance also remains a separate
consumer contract; portable account tests cannot substitute for its authorization,
review, source/release and environment checks.
