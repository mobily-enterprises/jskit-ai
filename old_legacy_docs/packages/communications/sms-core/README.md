# @jskit-ai/sms-core

SMS sending service contract for backend apps.

## What this package is for

Use this package to standardize SMS behavior across apps:

- validate recipient phone numbers
- validate message text length
- return predictable result objects for configured and unconfigured drivers

Current drivers:

- `none` (disabled mode)
- `plivo` (configuration recognized, sending currently returns `not_implemented`)

## Key terms (plain language)

- `driver`: the SMS provider mode your app runs with.
- `E.164`: standard international phone format like `+14155551234`.

## Exports

- `@jskit-ai/sms-core`
- `@jskit-ai/sms-core/service`

Public runtime API:

- `createService(options)`

`__testables` is for tests only.

## Function reference

### `createService(options)`

Creates an SMS service instance.

- `options.driver`: `"none"` or `"plivo"`.
- `options.plivoAuthId`, `options.plivoAuthToken`, `options.plivoSourceNumber`: optional Plivo credentials.

Returns:

- `driver`
- `sendSms(payload)`

### `sendSms({ to, text })`

Attempts to send an SMS and always returns a normalized response object:

- invalid recipient -> `{ sent: false, reason: "invalid_recipient" }`
- invalid/too-long text -> `{ sent: false, reason: "invalid_message" }`
- driver not configured -> `{ sent: false, reason: "not_configured" }`
- plivo path currently stubbed -> `{ sent: false, reason: "not_implemented" }`

Practical example:

- user enables 2FA and enters an invalid phone number: service returns `invalid_recipient` without throwing.

## Practical usage example

```js
import { createService as createSmsService } from "@jskit-ai/sms-core";

const smsService = createSmsService({
  driver: process.env.SMS_DRIVER,
  plivoAuthId: process.env.PLIVO_AUTH_ID,
  plivoAuthToken: process.env.PLIVO_AUTH_TOKEN,
  plivoSourceNumber: process.env.PLIVO_SOURCE_NUMBER
});

const result = await smsService.sendSms({
  to: "+14155550199",
  text: "Your verification code is 482193"
});
```

## How `jskit-value-app` uses it and why

Real usage:

- `apps/jskit-value-app/server/runtime/services.js`
- `apps/jskit-value-app/tests/smsService.test.js`

Why:

- app code gets a stable contract (`sent`, `reason`, `provider`) independent of provider wiring
- validation and driver gating are shared and testable

## Non-goals

- no direct integration with all SMS providers
- no message templating
- no delivery status polling yet
