import assert from "node:assert/strict";
import test from "node:test";
import { createAuthExtensions } from "@jskit-ai/auth-core/server/authExtensions";
import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createBootstrapRuntime } from "@jskit-ai/kernel/server/runtime";
import { ConsoleFeature } from "../src/server/ConsoleFeature.js";

test("ConsoleFeature assembles owner access, settings, routes, actions, and bootstrap explicitly", async () => {
  const routes = [];
  const authExtensions = createAuthExtensions();
  const bootstrap = createBootstrapRuntime();
  let actions = null;
  let console = null;
  const probe = defineProvider({
    id: "test.console.probe",
    requires: {
      actionCatalogue: "runtime.actions",
      consoleCapability: "console.core"
    },
    setup({ actionCatalogue, consoleCapability }) {
      actions = actionCatalogue;
      console = consoleCapability;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: {
      "auth.extensions": authExtensions,
      "runtime.bootstrap": bootstrap,
      "runtime.database": { knex() {} },
      "runtime.http": {
        router: {
          register(method, path) {
            routes.push(`${method} ${path}`);
          }
        }
      }
    },
    providers: [createActionProvider(), ConsoleFeature, probe]
  });

  await runtime.start();

  assert.equal(typeof console.services.access.requireConsoleOwner, "function");
  assert.equal(typeof console.services.settings.updateSettings, "function");
  assert.deepEqual(routes, [
    "GET /api/console/settings",
    "PATCH /api/console/settings"
  ]);
  assert.deepEqual(
    actions.listDefinitions().map((definition) => definition.id),
    ["console.settings.read", "console.settings.update"]
  );
  assert.deepEqual(bootstrap.diagnostics().contributorIds, ["console.bootstrap"]);
  assert.deepEqual(authExtensions.diagnostics().serviceDecoratorIds, [
    "console.core.authServiceDecorator"
  ]);
});
