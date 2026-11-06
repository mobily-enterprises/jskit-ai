import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import "vuetify/styles";
import "@jskit-ai/material-web/client/material.css";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { shellScrollBehavior } from "@jskit-ai/kernel/client";
import { silentLogger } from "@jskit-ai/kernel/shared/support/silentLogger";
import ShellSurfaceAwareMenuLinkItem from "@jskit-ai/shell-web/client/components/ShellSurfaceAwareMenuLinkItem";
import ShellTabLinkItem from "@jskit-ai/shell-web/client/components/ShellTabLinkItem";
import { useShellErrorPresentationStore } from "../../../shell-web/src/client/stores/useShellErrorPresentationStore.js";
import { createWebPlacementRuntime } from "../../../shell-web/src/client/placement/runtime.js";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "../../../shell-web/src/client/placement/inject.js";
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "../../../shell-web/src/client/error/inject.js";
import { createErrorRuntime } from "../../../shell-web/src/client/error/runtime.js";
import { createDefaultMaterialErrorPresenters } from "../../../shell-web/src/client/error/presenters.js";
import { createErrorPresentationStore } from "../../../shell-web/src/client/error/store.js";
import {
  SHELL_NAVIGATION_RUNTIME_KEY,
  createShellNavigationRuntime
} from "../../../shell-web/src/client/navigation/shellNavigationRuntime.js";
import App from "./App.vue";
import BookEditPage from "../../patterns/crud-screen-set/example/books/BookEditPage.vue";
import BookListPage from "../../patterns/crud-screen-set/example/books/BookListPage.vue";
import BookNewPage from "../../patterns/crud-screen-set/example/books/BookNewPage.vue";
import BookViewPage from "../../patterns/crud-screen-set/example/books/BookViewPage.vue";

// The crud-screen-set pattern's pages in the real shell, as an application generated from it renders them. The
// file-based router's definePage() macro is a no-op here; each route carries the meta the page declares.
globalThis.definePage = () => {};

function destination(order, label, suffix, icon) {
  return {
    id: `fixture.${label.toLowerCase()}`,
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["app"],
    order,
    props: { label, icon, surface: "app", scopedSuffix: suffix, unscopedSuffix: suffix, exact: suffix === "/" }
  };
}

const menuRenderers = Object.freeze({ link: "fixture.surface-menu-link" });
const placementRuntime = createWebPlacementRuntime({
  components: new Map([
    ["fixture.surface-menu-link", ShellSurfaceAwareMenuLinkItem],
    ["fixture.tab-link", ShellTabLinkItem]
  ]),
  logger: silentLogger
});
placementRuntime.replacePlacements([
  destination(10, "Home", "/", "$home"),
  destination(20, "Books", "/books", "$description"),
  destination(30, "Settings", "/settings", "$settings")
]);
placementRuntime.replacePlacementTopology([
  {
    id: "shell.primary-nav",
    surfaces: ["*"],
    default: true,
    variants: {
      compact: { outlet: "shell-layout:primary-bottom-nav", renderers: { link: "fixture.tab-link" } },
      medium: { outlet: "shell-layout:primary-menu", renderers: menuRenderers },
      expanded: { outlet: "shell-layout:primary-menu", renderers: menuRenderers }
    }
  }
]);
placementRuntime.setContext({
  surfaceConfig: {
    defaultSurfaceId: "app",
    enabledSurfaceIds: ["app"],
    surfacesById: { app: { id: "app", routeBase: "/", pagesRoot: "", enabled: true, requiresWorkspace: false } }
  }
});

const routes = [
  { path: "/", component: { render: () => null }, meta: { jskit: { title: "Home" } } },
  { path: "/settings", component: { render: () => null }, meta: { jskit: { title: "Settings" } } },
  { path: "/books", component: BookListPage, meta: { jskit: { title: "Books" } } },
  { path: "/books/new", component: BookNewPage, meta: { jskit: { title: "New book", parent: "/books" } } },
  { path: "/books/:bookId", component: BookViewPage, meta: { jskit: { title: "Book", parent: "/books" } } },
  {
    path: "/books/:bookId/edit",
    component: BookEditPage,
    meta: { jskit: { title: "Edit book", parent: "/books/:bookId" } }
  }
];
const router = createRouter({ history: createWebHistory(), routes, scrollBehavior: shellScrollBehavior });
const navigationRuntime = createShellNavigationRuntime({ router });
navigationRuntime.install();

const pinia = createPinia();
const errorStore = createErrorPresentationStore();
const errorRuntime = createErrorRuntime({
  presenters: createDefaultMaterialErrorPresenters({ store: errorStore }),
  defaultPresenterId: "material.snackbar",
  logger: silentLogger
});

const app = createApp(App);
app.use(pinia);
app.use(router);
app.use(VueQueryPlugin, { queryClientConfig: { defaultOptions: { queries: { retry: false } } } });
app.use(createVuetify({ components, directives, ...createMaterialVuetifyOptions() }));
app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, placementRuntime);
app.provide(SHELL_NAVIGATION_RUNTIME_KEY, navigationRuntime);
app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, errorRuntime);
useShellErrorPresentationStore(pinia).attachRuntimeStore(errorStore);
await router.isReady();
app.mount("#app");
