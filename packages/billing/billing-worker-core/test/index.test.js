import assert from "node:assert/strict";
import test from "node:test";
import * as billingWorker from "../src/index.js";

test("billing worker core exports worker services", () => {
  assert.equal(typeof billingWorker.createBillingOutboxWorkerService, "function");
  assert.equal(typeof billingWorker.createBillingRemediationWorkerService, "function");
  assert.equal(typeof billingWorker.createBillingReconciliationService, "function");
  assert.equal(typeof billingWorker.createBillingWorkerRuntimeService, "function");
});
