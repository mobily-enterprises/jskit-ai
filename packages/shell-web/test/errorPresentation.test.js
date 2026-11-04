import assert from "node:assert/strict";
import test from "node:test";
import { mdiAlertOutline, mdiCheckCircleOutline, mdiInformationOutline } from "@mdi/js";
import {
  actionsFor,
  resolveBannerPlacement,
  resolveSeverityColor,
  resolveSeverityIcon,
  resolveTimeout
} from "../src/client/error/presentation.js";

test("each severity has its color and icon, and anything else reads as an error", () => {
  assert.equal(resolveSeverityColor(" INFO "), "info");
  assert.equal(resolveSeverityColor("success"), "success");
  assert.equal(resolveSeverityColor("warning"), "warning");
  assert.equal(resolveSeverityColor("critical"), "error");
  assert.equal(resolveSeverityColor(""), "error");

  assert.equal(resolveSeverityIcon("info"), mdiInformationOutline);
  assert.equal(resolveSeverityIcon("success"), mdiCheckCircleOutline);
  assert.equal(resolveSeverityIcon("warning"), mdiAlertOutline);
  assert.equal(resolveSeverityIcon("error"), mdiAlertOutline);
});

test("a snackbar times out unless it persists or shows nothing", () => {
  assert.equal(resolveTimeout(null), -1);
  assert.equal(resolveTimeout({ persist: true }), -1);
  assert.equal(resolveTimeout({ persist: false }), 5000);
});

test("an entry's actions list its action first and skip an empty one", () => {
  const action = { label: "Retry" };
  const additional = { label: "Details" };

  assert.deepEqual(actionsFor(null), []);
  assert.deepEqual(actionsFor({ action, additionalActions: [additional] }), [action, additional]);
  assert.deepEqual(actionsFor({ action: null, additionalActions: [additional] }), [additional]);
});

test("banners float below a top app bar and join the page without one", () => {
  assert.deepEqual(resolveBannerPlacement({ top: 0 }), { inline: true, style: undefined });
  assert.deepEqual(resolveBannerPlacement({}), { inline: true, style: undefined });
  assert.deepEqual(resolveBannerPlacement({ top: 64, left: 256, right: 0 }), {
    inline: false,
    style: {
      top: "calc(env(safe-area-inset-top, 0px) + 64px)",
      left: "256px",
      right: "0px"
    }
  });
});
