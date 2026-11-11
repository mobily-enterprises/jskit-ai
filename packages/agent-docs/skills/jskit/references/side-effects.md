<!-- Generated from `packages/agent-docs/site/guide/framework/side-effects.md`. -->

# Side effects and test copies

An application reads one environment variable, `SIDE_EFFECTS`:

- `live`: the application acts for real.
- Anything else, including unset, means `simulate`: the copy is a **test
  copy**. It sends no real email, SMS, push notification, payment or
  third-party webhook. It simulates each one, writes it to the log, and every
  page shows a small "Test copy" banner.

Only the copy that serves real people sets `SIDE_EFFECTS=live`. Development,
previews, tests and staging leave it unset. The name has no platform prefix on
purpose: any host can set it. The host sets it; a request never chooses it.

## What JSKIT does

- Every HTML page the server sends, and every page the Vite development server
  sends, names the setting in a `jskit-side-effects` meta tag. The shell
  (`@jskit-ai/shell-web`) shows the "Test copy" banner from it, with no
  application code. The banner never takes a click or a tap. Screen readers
  read it as a note, with "emails, messages and payments are simulated, not
  sent" as its description. It has no label, so a browser test's
  `getByLabel("Email")` never finds it.
- The server logs once at startup whether it acts for real. A production server
  that simulates logs a warning.
- Local-password emails (confirmation and password reset) with an installed
  sender are logged, not sent.
- Workspace invitations with a provided mailer are logged. The invitation
  answers `status: "simulated"`, and the inviter copies the link.
- Accounts-hub email is logged, not sent.
- Connector operations that act on the world (send an email or message, post,
  book or cancel, charge, invoice, trigger another system's events) are marked
  `sideEffect`. They are checked like real ones, then logged, and `invoke`
  answers `{ simulated: true }`. Reads run for real. `createConnectorsFeature`
  reads the setting itself; give `createConnectionService` and
  `createPaymentCheckoutService` `sideEffects: resolveSideEffectsMode(env)`.
- Payment checkout and the billing portal in the live payment environment are
  refused with `payment_test_copy`; the sandbox environment works either way.

Supabase sends its own authentication emails from Supabase's servers; JSKIT
cannot simulate them. Point a test copy at a separate Supabase project.

## The application's own side effects

Code the application writes that reaches the world follows the same rule.
Decide at the point of the effect: log what would happen and answer as if it
were done.

```js
import { sideEffectsAreLive } from "@jskit-ai/kernel/shared/support/sideEffects";
import { logSimulatedSideEffect } from "@jskit-ai/kernel/server/runtime/sideEffects";

async function sendReminder({ env, logger, mailer }, message) {
  if (!sideEffectsAreLive(env)) {
    logSimulatedSideEffect(logger, { kind: "email", summary: `the reminder to ${message.to}`, details: { to: message.to } });
    return { simulated: true };
  }
  return mailer.send(message);
}
```

- Read `env` from the `runtime.env` capability, never a request.
- A configured driver or key (`EMAIL_DRIVER=ses`, a live payment key) does not
  make a test copy live; only `SIDE_EFFECTS=live` does.
- Test both modes. A test that proves a real sender against a fake transport
  sets `SIDE_EFFECTS: "live"` in its environment.
