import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "vue";
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "@jskit-ai/shell-web/client/error";
import { useUiFeedback } from "../src/client/composables/runtime/useUiFeedback.js";

const CAVEAT = "Invite created, but email delivery failed. Copy the invite link to share it.";

// One feedback runtime and what it reports to, and dismisses from, the shell.
function feedbackWithShell(options) {
  const reports = [];
  const dismissed = [];
  const app = createApp({ render: () => null });
  app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, {
    report(event) {
      reports.push(event);
      return { presentationId: `presentation-${reports.length}`, decision: { presenterId: "snackbar" } };
    },
    dismiss(presentationId) {
      dismissed.push(presentationId);
    }
  });
  const feedback = app.runWithContext(() => useUiFeedback(options));
  return { feedback, reports, dismissed };
}

test("warning() shows an action that did its work with a catch as a warning", () => {
  const { feedback, reports } = feedbackWithShell({ source: "members.invite" });

  feedback.warning(CAVEAT);

  assert.equal(feedback.messageType.value, "warning");
  assert.equal(feedback.message.value, CAVEAT);
  assert.deepEqual(reports, [{
    source: "members.invite",
    message: CAVEAT,
    intent: "action-feedback",
    severity: "warning",
    channel: "",
    dedupeKey: `members.invite:warning:${CAVEAT}`,
    dedupeWindowMs: 2000
  }]);
});

test("warning() goes to the warning channel and puts away an earlier attempt's error", () => {
  const { feedback, reports, dismissed } = feedbackWithShell({ warningChannel: "banner", successChannel: "snackbar" });

  feedback.error(new Error("Unable to create invite."));
  feedback.warning(CAVEAT);

  assert.deepEqual(dismissed, ["presentation-1"]);
  assert.equal(reports[1].channel, "banner");
});

test("success() still reports a success on its own channel", () => {
  const { feedback, reports } = feedbackWithShell({ warningChannel: "banner", successChannel: "snackbar" });

  feedback.success("Invite sent.");

  assert.equal(feedback.messageType.value, "success");
  assert.equal(reports[0].severity, "success");
  assert.equal(reports[0].channel, "snackbar");
  assert.equal(reports[0].dedupeKey, "http-web.ui-feedback:success:Invite sent.");
});
