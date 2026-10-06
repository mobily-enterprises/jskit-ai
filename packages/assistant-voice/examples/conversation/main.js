import { createApp, shallowRef } from "vue";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createRouter, createWebHistory } from "vue-router";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
import { bootClientModules } from "@jskit-ai/kernel/client/moduleBootstrap";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import { ShellWebClientProvider } from "@jskit-ai/shell-web/client";
import { RealtimeClientProvider } from "@jskit-ai/realtime/client";
import { configureAssistantConversations } from "@jskit-ai/assistant-runtime/client";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import "vuetify/styles";
import App from "./App.vue";
import { appConfig } from "./config.js";

globalThis.__JSKIT_CLIENT_APP_CONFIG__ = appConfig;
const example = shallowRef({ subjectId: "", conversations: [], provider: "Loading application configuration…" });
// This local app uses its existing Origin guard, rather than a hosted CSRF session.
const http = createHttpClient({ credentials: "include", csrf: { enabled: false } });
const ExampleClientProvider = defineProvider({
  id: "example.client",
  requires: { shell: "client.shell", vueApp: "client.vue" },
  setup({ shell, vueApp }) {
    shell.bootstrapHandlers.register({ handlerId: "example.application", applyBootstrapPayload({ payload }) {
      example.value = payload.example;
    } });
    vueApp.provide("example.application", example);
    return {};
  }
});
const app = createApp(App);
configureAssistantConversations(app, {
  actorKey: () => example.value.subjectId, request: http.request, clearDraftOn: "accepted"
});
const pinia = createPinia();
const queryClient = new QueryClient();
const router = createRouter({ history: createWebHistory(), routes: [{ path: "/:pathMatch(.*)*", component: App }] });
app.use(pinia).use(VueQueryPlugin, { queryClient }).use(router)
  .use(createVuetify({ components, directives, icons: { defaultSet: "mdi", aliases, sets: { mdi } } }));
const modules = await bootClientModules({
  app, pinia, queryClient, router, env: import.meta.env, surfaceMode: "home",
  surfaceRuntime: createSurfaceRuntime({ defaultSurfaceId: "home", surfaces: appConfig.surfaceDefinitions }),
  clientModules: [
    { packageId: "@jskit-ai/shell-web", module: { ShellWebClientProvider },
      packageMetadataClientProviders: [{ export: "ShellWebClientProvider" }] },
    { packageId: "@jskit-ai/realtime", module: { RealtimeClientProvider },
      packageMetadataClientProviders: [{ export: "RealtimeClientProvider" }] },
    { packageId: "example", module: { ExampleClientProvider },
      packageMetadataClientProviders: [{ export: "ExampleClientProvider" }] }
  ]
});
await router.isReady();
app.mount("#app");
if (import.meta.hot) import.meta.hot.dispose(() => { app.unmount(); void modules.runtime.shutdown(); });
