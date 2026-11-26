import assert from "node:assert/strict";
import test from "node:test";
import { createRenderer, defineComponent } from "vue";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "@jskit-ai/shell-web/client/placement";
import { useSignOutView } from "../src/client/composables/useSignOutView.js";
import { AUTH_GUARD_RUNTIME_INJECTION_KEY } from "../src/client/runtime/inject.js";
import { clearAuthCsrfTokenCache } from "../src/client/runtime/authHttpClient.js";

function node(type) {
  return { type, children: [], parent: null };
}

const renderer = createRenderer({
  createElement: node,
  createText: () => node("text"),
  createComment: () => node("comment"),
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: (item) => item.parent,
  nextSibling: () => null,
  insert(item, parent) {
    item.parent = parent;
    parent.children.push(item);
  },
  remove(item) {
    item.parent?.children.splice(item.parent.children.indexOf(item), 1);
  }
});

function createJsonResponse(payload = {}) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => (String(name || "").toLowerCase() === "content-type" ? "application/json" : null)
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

const PLACEMENT_CONTEXT = Object.freeze({
  surfaceConfig: {
    tenancyMode: "none",
    defaultSurfaceId: "home",
    enabledSurfaceIds: ["home", "auth"],
    surfacesById: {
      home: { id: "home", enabled: true, pagesRoot: "home", routeBase: "/home", requiresWorkspace: false },
      auth: { id: "auth", enabled: true, pagesRoot: "auth", routeBase: "/auth", requiresWorkspace: false }
    }
  }
});

// Signs out on the page `/auth/signout${search}` and gives the address the browser is sent to.
async function signOutAt(t, search) {
  const originalWindow = globalThis.window;
  const destinations = [];
  globalThis.window = {
    location: {
      href: `https://example.com/auth/signout${search}`,
      origin: "https://example.com",
      search,
      replace: (path) => destinations.push(path),
      assign: (path) => destinations.push(path)
    }
  };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    clearAuthCsrfTokenCache();
  });
  t.mock.method(globalThis, "fetch", async () => createJsonResponse({ ok: true, authenticated: false, csrfToken: "csrf" }));

  const app = renderer.createApp(
    defineComponent({
      setup() {
        useSignOutView();
        return () => null;
      }
    })
  );
  app.provide(AUTH_GUARD_RUNTIME_INJECTION_KEY, { refresh: async () => ({ authenticated: false }) });
  app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, {
    getContext: () => PLACEMENT_CONTEXT,
    setContext: () => PLACEMENT_CONTEXT,
    getPlacements: () => [],
    getRevision: () => 0,
    subscribe: () => () => {}
  });
  app.mount(node("root"));
  t.after(() => app.unmount());
  for (let turn = 0; turn < 50 && destinations.length === 0; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return destinations;
}

test("a sign-out without a returnTo opens sign-in without one, so the sign-in's own landing applies", async (t) => {
  assert.deepEqual(await signOutAt(t, ""), ["/auth/login"]);
});

test("a sign-out with a returnTo passes it on to sign-in", async (t) => {
  assert.deepEqual(await signOutAt(t, "?returnTo=%2Fhome"), ["/auth/login?returnTo=%2Fhome"]);
});
