import assert from "node:assert/strict";
import test from "node:test";
import { registerConsoleSettings } from "../src/server/consoleSettings/registerConsoleSettings.js";

function createAppDouble() {
  const serviceCalls = [];

  return {
    serviceCalls,
    app: {
      singleton() {
        return this;
      },
      service(token, factory, metadata) {
        serviceCalls.push({
          token,
          factory,
          metadata
        });
        return this;
      },
      actions() {
        return this;
      }
    }
  };
}

function findServiceCall(serviceCalls, token) {
  return serviceCalls.find((entry) => entry.token === token) || null;
}

test("console settings register publishes console.settings.changed", () => {
  const payload = createAppDouble();
  registerConsoleSettings(payload.app);
  const consoleSettings = findServiceCall(payload.serviceCalls, "console.settings.service");
  assert.equal(consoleSettings?.metadata?.events?.updateSettings?.[0]?.realtime?.event, "console.settings.changed");
});
