import { createApp, ref } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import "vuetify/styles";
import "@jskit-ai/material-web/client/material.css";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import App from "./App.vue";
import { createWebPlacementRuntime } from "../../../shell-web/src/client/placement/runtime.js";
import { createFixtureSocket } from "./socket.js";
import { assistantHttpClient, createAssistantApi } from "@jskit-ai/assistant-core/client";
import { configureAssistantConversations, useAssistantConversation } from "../../src/client/composables/useAssistantConversation.js";
import { silentLogger } from "@jskit-ai/kernel/shared/support/silentLogger";

globalThis.__JSKIT_CLIENT_APP_CONFIG__ = {
  surfaceDefinitions: { home: { requiresWorkspace: false } },
  assistantSurfaces: { home: { settingsSurfaceId: "home", configScope: "global" } }
};
const placement = createWebPlacementRuntime({ components: new Map(), logger: silentLogger });
placement.setContext({ user: { id: "42" }, surfaceConfig: {
  defaultSurfaceId: "home", surfacesById: { home: { id: "home", routeBase: "/", requiresWorkspace: false } }
} });
const socket = createFixtureSocket();
const app = createApp(App);
const router = createRouter({ history: createWebHistory(), routes: [{ path: "/:pathMatch(.*)*", component: App }] });
if (new URLSearchParams(window.location.search).has("applicationDefaults")) {
  const actor = ref("application-user");
  const requests = [], overrideRequests = [];
  configureAssistantConversations(app, {
    actorKey: actor, clearDraftOn: "accepted",
    request(path, options) { requests.push(path); return assistantHttpClient.request(path, options); }
  });
  const overrideApi = createAssistantApi({
    request(path, options) { overrideRequests.push(path); return assistantHttpClient.request(path, options); },
    resolveBasePath: () => "/api/assistant/home", resolveSurfaceId: () => "home"
  });
  let otherApp, otherBinding, otherRoot;
  window.conversationDefaultsFixture = {
    actor(value) { actor.value = value; }, requests, overrideRequests, overrideApi,
    mountOtherApp() {
      otherApp = createApp({ setup() {
        otherBinding = useAssistantConversation({ conversationId: "chat:1" });
        return () => null;
      } });
      otherApp.provide("jskit.shell-web.runtime.web-placement.client", placement);
      otherApp.provide("jskit.realtime.runtime.client.socket", socket);
      otherApp.use(router);
      otherRoot = document.createElement("div");
      document.body.append(otherRoot);
      otherApp.mount(otherRoot);
    },
    other() { return otherBinding.runtime.value; },
    unmountOtherApp() { otherApp.unmount(); otherRoot.remove(); },
    // An application without realtime: returns what mounting a conversation there fails with.
    mountWithoutSocket() {
      let refusal = "";
      const application = createApp({ setup() {
        useAssistantConversation({ conversationId: "chat:1" });
        return () => null;
      } });
      application.config.errorHandler = failure => { refusal = failure.message; };
      application.provide("jskit.shell-web.runtime.web-placement.client", placement);
      application.use(router);
      application.mount(document.createElement("div"));
      return refusal;
    }
  };
}
app.provide("jskit.shell-web.runtime.web-placement.client", placement);
app.provide("jskit.realtime.runtime.client.socket", socket);
app.provide("fixture", { placement, socket });
app.use(router).use(createVuetify({ components, directives, ...createMaterialVuetifyOptions() }));
await router.isReady();
app.mount("#app");
