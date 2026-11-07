import assert from "node:assert/strict";
import test from "node:test";
import { createAuthExtensions } from "@jskit-ai/auth-core/server/authExtensions";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createBootstrapRuntime, EventProvider } from "@jskit-ai/kernel/server/runtime";
import { ConsoleFeature } from "../src/server/ConsoleFeature.js";

test("ConsoleFeature assembles owner access, settings, routes, actions, and bootstrap explicitly", async () => {
  const routes = [];
  const authExtensions = createAuthExtensions();
  const bootstrap = createBootstrapRuntime();
  let actions = null;
  let console = null;
  let consoleSettings = null;
  const probe = defineProvider({
    id: "test.console.probe",
    requires: {
      actionCatalogue: "runtime.actions",
      consoleCapability: "console.core",
      settingsCapability: "console.settings"
    },
    setup({ actionCatalogue, consoleCapability, settingsCapability }) {
      actions = actionCatalogue;
      console = consoleCapability;
      consoleSettings = settingsCapability;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.logger": silentLogger,
      "auth.extensions": authExtensions,
      "runtime.bootstrap": bootstrap,
      // The console feature's handle is only kept by its repository, so a resource runtime that hands out stubs will do.
      "runtime.resources": {
        own(featureId, owns) {
          return Object.fromEntries(owns.map((entry) => [(entry.resource ?? entry).name, {}]));
        }
      },
      "runtime.http": {
        router: {
          register(method, path) {
            routes.push(`${method} ${path}`);
          }
        }
      }
    },
    providers: [EventProvider, ActionProvider, ConsoleFeature, probe]
  });

  await runtime.start();

  assert.equal(typeof console.services.access.requireConsoleOwner, "function");
  assert.equal(typeof console.services.settings.updateSettings, "function");
  assert.equal(typeof consoleSettings.getSingleton, "function");
  assert.equal(Object.hasOwn(console, "repositories"), false);
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
