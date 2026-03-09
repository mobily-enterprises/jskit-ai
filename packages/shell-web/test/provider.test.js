import assert from "node:assert/strict";
import test from "node:test";
import { ShellWebClientProvider } from "../src/client/providers/ShellWebClientProvider.js";
import {
  WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN,
  WEB_PLACEMENT_RUNTIME_INJECTION_KEY
} from "../src/client/placement/tokens.js";
import { CLIENT_MODULE_VUE_APP_TOKEN } from "@jskit-ai/kernel/client/moduleBootstrap";

function createAppDouble() {
  const singletons = new Map();
  const provided = [];
  const plugins = [];

  const vueApp = {
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
      const factory = singletons.get(token);
      if (!factory) {
        throw new Error(`Unknown token ${String(token)}`);
      }
      return factory(this);
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

  await provider.boot(app);
  assert.equal(app.plugins.length, 1);
  assert.equal(typeof app.plugins[0].plugin.install, "function");
  assert.equal(typeof app.plugins[0].options?.queryClient, "object");
  assert.equal(app.provided.length, 1);
  assert.equal(app.provided[0].key, WEB_PLACEMENT_RUNTIME_INJECTION_KEY);
  assert.equal(typeof app.provided[0].value.getPlacements, "function");
  assert.equal(typeof app.provided[0].value.getContext, "function");
  assert.equal(typeof app.provided[0].value.setContext, "function");
});
