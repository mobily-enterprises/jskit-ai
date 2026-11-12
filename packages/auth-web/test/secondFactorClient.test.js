import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "vue";
import { encode } from "uqr";
import { SECOND_FACTOR_REQUIRED } from "@jskit-ai/auth-core/shared/authSecondFactor";
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "@jskit-ai/shell-web/client/error";
import { useSecondFactorProof } from "../src/client/composables/secondFactor/useSecondFactorProof.js";
import { useSecondFactorStepUp } from "../src/client/composables/secondFactor/useSecondFactorStepUp.js";
import { qrCodePath } from "../src/client/lib/qrCode.js";

const QUIET_ZONE = 4;

/** An error as auth-web's HTTP client throws it for a refused request. */
function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code, params: {}, fieldErrors: null });
}

function settled() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("a QR code's path draws exactly its code's dark modules, inside a quiet zone of four modules", () => {
  const text = "otpauth://totp/Console:ada%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Console";
  const { size, path } = qrCodePath(text);
  const runs = [...path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/gu)];
  assert.equal(runs.map(([run]) => run).join(""), path, "the path is rectangles one module tall");
  const drawn = Array.from({ length: size }, () => Array(size).fill(false));
  for (const [, x, y, length] of runs) {
    for (let column = Number(x); column < Number(x) + Number(length); column += 1) {
      assert.equal(drawn[Number(y)][column], false, "no module is drawn twice");
      drawn[Number(y)][column] = true;
    }
  }
  assert.deepEqual(drawn, encode(text, { border: QUIET_ZONE }).data);
  const edges = [...drawn.slice(0, QUIET_ZONE), ...drawn.slice(-QUIET_ZONE)].flat()
    .concat(drawn.flatMap((row) => [...row.slice(0, QUIET_ZONE), ...row.slice(-QUIET_ZONE)]));
  assert.equal(edges.some(Boolean), false);
});

test("a request refused for the second factor waits for the proof, then runs once more; cancelling throws the refusal", async () => {
  const stepUp = useSecondFactorStepUp();
  const refused = httpError(403, SECOND_FACTOR_REQUIRED.code, SECOND_FACTOR_REQUIRED.message);
  const calls = { refund: 0, export: 0 };
  const refund = stepUp.run(async () => {
    calls.refund += 1;
    if (calls.refund === 1) throw refused;
    return { refunded: true };
  });
  const exported = stepUp.run(async () => {
    calls.export += 1;
    if (calls.export === 1) throw refused;
    return { exported: true };
  });
  await settled();
  assert.equal(stepUp.open.value, true);
  assert.deepEqual(calls, { refund: 1, export: 1 }, "nothing runs again before the proof");
  stepUp.verified();
  assert.equal(stepUp.open.value, false);
  assert.deepEqual(await refund, { refunded: true });
  assert.deepEqual(await exported, { exported: true });
  assert.deepEqual(calls, { refund: 2, export: 2 });

  let cancelledCalls = 0;
  const cancelled = stepUp.run(async () => {
    cancelledCalls += 1;
    throw refused;
  });
  await settled();
  assert.equal(stepUp.open.value, true);
  stepUp.cancel();
  assert.equal(stepUp.open.value, false);
  await assert.rejects(cancelled, (error) => error === refused);
  assert.equal(cancelledCalls, 1, "a cancelled request does not run again");

  // A refusal for anything else is the caller's, and asks for no code.
  const forbidden = httpError(403, "auth.forbidden", "You can't do that.");
  await assert.rejects(stepUp.run(async () => {
    throw forbidden;
  }), (error) => error === forbidden);
  assert.equal(stepUp.open.value, false);
});

test("a refused code shows beside its field, any other failure is reported, and a proof that passes is handed on", async () => {
  const reports = [];
  const answers = [
    httpError(400, "auth.local.secondFactor.codeInvalid", "That code is not right. Enter the code your authenticator app shows now."),
    httpError(429, "auth.local.secondFactor.locked", "Too many wrong codes. Try again in 1 minute."),
    httpError(0, null, "Network request failed."),
    httpError(409, "auth.local.secondFactor.notSetUp", "No authenticator is set up for this account."),
    { verifiedAt: "2026-11-13T10:00:00.000Z", method: "recoveryCode", recoveryCodesLeft: 9 }
  ];
  const submitted = [];
  const done = [];
  const app = createApp({});
  app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, { report: (event) => reports.push(event), dismiss: () => 0 });
  const proof = app.runWithContext(() => useSecondFactorProof({
    async submit(typed) {
      submitted.push(typed);
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return answer;
    },
    onDone: (result) => done.push(result)
  }));

  assert.equal(proof.canSubmit.value, false, "nothing typed, nothing to send");
  proof.code.value = " 123 456 ";
  await proof.submitProof();
  assert.equal(proof.fieldError.value, "That code is not right. Enter the code your authenticator app shows now.");
  assert.equal(proof.code.value, " 123 456 ", "the code stays to be corrected");

  await proof.submitProof();
  assert.equal(proof.fieldError.value, "Too many wrong codes. Try again in 1 minute.");

  await proof.submitProof();
  assert.equal(proof.fieldError.value, "");
  assert.deepEqual(reports.map(({ message, severity, channel }) => ({ message, severity, channel })), [
    { message: "Network request failed.", severity: "error", channel: "snackbar" }
  ]);

  await proof.submitProof();
  assert.equal(proof.fieldError.value, "No authenticator is set up for this account.");
  proof.toggleRecoveryCode();
  assert.equal(proof.fieldError.value, "", "the other field starts clean");
  assert.equal(proof.canSubmit.value, false);
  proof.recoveryCode.value = "abcde-fghjk";
  await proof.submitProof();

  assert.deepEqual(submitted, [
    { code: "123 456" },
    { code: "123 456" },
    { code: "123 456" },
    { code: "123 456" },
    { recoveryCode: "abcde-fghjk" }
  ]);
  assert.deepEqual(done, [{ verifiedAt: "2026-11-13T10:00:00.000Z", method: "recoveryCode", recoveryCodesLeft: 9 }]);
  assert.equal(proof.recoveryCode.value, "");
  assert.equal(proof.pending.value, false);
  assert.equal(reports.length, 1);
});
