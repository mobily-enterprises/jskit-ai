import assert from "node:assert/strict";
import test from "node:test";
import { ShellWebClientProvider } from "../src/client/providers/ShellWebClientProvider.js";
import {
  WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN,
  WEB_PLACEMENT_RUNTIME_INJECTION_KEY
} from "../src/client/placement/tokens.js";
import {
  SHELL_WEB_ERROR_PRESENTATION_STORE_CLIENT_TOKEN,
  SHELL_WEB_ERROR_PRESENTATION_STORE_INJECTION_KEY,
  SHELL_WEB_ERROR_RUNTIME_CLIENT_TOKEN,
  SHELL_WEB_ERROR_RUNTIME_INJECTION_KEY
} from "../src/client/error/tokens.js";
import { CLIENT_MODULE_VUE_APP_TOKEN } from "@jskit-ai/kernel/client/moduleBootstrap";

function createAppDouble() {
  const singletons = new Map();
  const singletonInstances = new Map();
  const provided = [];
  const plugins = [];

  const vueApp = {
    config: {},
    use(plugin, options) {
      plugins.push({ plugin, options });
      return this;
    },
    provide(key, value) {
      provided.push({ key, value });
    }
  };

  return {
    singletons,
    provided,
    plugins,
    vueApp,
    singleton(token, factory) {
      singletons.set(token, factory);
    },
    has(token) {
      return token === CLIENT_MODULE_VUE_APP_TOKEN;
    },
    make(token) {
      if (token === CLIENT_MODULE_VUE_APP_TOKEN) {
        return vueApp;
      }
      if (singletonInstances.has(token)) {
        return singletonInstances.get(token);
      }
      const factory = singletons.get(token);
      if (!factory) {
        throw new Error(`Unknown token ${String(token)}`);
      }
      const instance = factory(this);
      singletonInstances.set(token, instance);
      return instance;
    },
    resolveTag() {
      return [];
    }
  };
}

test("shell web client provider binds runtime and injects it into Vue app", async () => {
  const app = createAppDouble();
  const provider = new ShellWebClientProvider();

  provider.register(app);
  assert.equal(app.singletons.has(WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN), true);
  assert.equal(app.singletons.has(SHELL_WEB_ERROR_RUNTIME_CLIENT_TOKEN), true);
  assert.equal(app.singletons.has(SHELL_WEB_ERROR_PRESENTATION_STORE_CLIENT_TOKEN), true);

  await provider.boot(app);
  assert.equal(app.plugins.length, 1);
  assert.equal(typeof app.plugins[0].plugin.install, "function");
  assert.equal(typeof app.plugins[0].options?.queryClient, "object");

  const providedByKey = new Map(app.provided.map((entry) => [entry.key, entry.value]));

  assert.equal(providedByKey.has(WEB_PLACEMENT_RUNTIME_INJECTION_KEY), true);
  assert.equal(providedByKey.has(SHELL_WEB_ERROR_RUNTIME_INJECTION_KEY), true);
  assert.equal(providedByKey.has(SHELL_WEB_ERROR_PRESENTATION_STORE_INJECTION_KEY), true);

  const placementRuntime = providedByKey.get(WEB_PLACEMENT_RUNTIME_INJECTION_KEY);
  assert.equal(typeof placementRuntime.getPlacements, "function");
  assert.equal(typeof placementRuntime.getContext, "function");
  assert.equal(typeof placementRuntime.setContext, "function");

  const errorRuntime = providedByKey.get(SHELL_WEB_ERROR_RUNTIME_INJECTION_KEY);
  assert.equal(typeof errorRuntime.report, "function");
  assert.equal(typeof errorRuntime.configure, "function");

  const errorStore = providedByKey.get(SHELL_WEB_ERROR_PRESENTATION_STORE_INJECTION_KEY);
  assert.equal(typeof errorStore.getState, "function");
  assert.equal(typeof errorStore.present, "function");
});
