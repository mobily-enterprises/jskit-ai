import assert from "node:assert/strict";
import test from "node:test";
import { reactive, ref } from "vue";
import { routeLocationKey, routerKey } from "vue-router";
import { useShellRouteTransition } from "../src/client/composables/useShellRouteTransition.js";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "../src/client/placement/inject.js";
import { installPage, mountComposable } from "./support/mountComposable.js";

const SURFACE_CONFIG = Object.freeze({
  defaultSurfaceId: "home",
  enabledSurfaceIds: ["home"],
  surfacesById: {
    home: { id: "home", pagesRoot: "home", routeBase: "/home", enabled: true }
  }
});

function createPlacementRuntime() {
  const placements = [
    { id: "home", target: "shell.primary-nav", props: { to: "/home", exact: true } },
    { id: "contacts", target: "shell.primary-nav", props: { to: "/home/contacts" } },
    { id: "bookings", target: "shell.primary-nav", props: { to: "/home/bookings" } }
  ];
  return {
    getContext: () => ({ surfaceConfig: SURFACE_CONFIG }),
    getPlacements: () => placements,
    getRevision: () => 1,
    subscribe: () => () => {}
  };
}

function mountTransition(t, { path = "/home/contacts", displayName = "xs", props = {} } = {}) {
  const page = installPage(t);
  const route = reactive({ path, params: {} });
  const pushes = [];
  const router = {
    async push(href) {
      pushes.push(href);
      route.path = href;
    }
  };
  const { app, result } = mountComposable(
    () => useShellRouteTransition({
      enabled: true,
      target: "shell-layout:primary-bottom-nav",
      semanticTarget: "shell.primary-nav",
      swipeEnabled: true,
      ...props
    }),
    {
      provide: [
        [routerKey, router],
        [routeLocationKey, route],
        [Symbol.for("vuetify:display"), { name: ref(displayName), mobile: ref(false) }],
        [SHELL_WEB_PLACEMENT_RUNTIME_KEY, createPlacementRuntime()]
      ]
    }
  );
  return { app, page, pushes, result, route };
}

const touch = { isPrimary: true, button: 0, pointerType: "touch", pointerId: 3 };

test("a swipe moves between destinations and names the direction of the motion", (t) => {
  const { app, page, pushes, result } = mountTransition(t);
  assert.equal(page.classes.has("shell-route-swipe-enabled"), true);
  assert.equal(result.routeTransitionName.value, "");

  page.dispatch("pointerdown", { ...touch, clientX: 300, clientY: 100 });
  page.dispatch("pointermove", { ...touch, clientX: 200, clientY: 102 });

  assert.deepEqual(pushes, ["/home/bookings"]);
  assert.equal(result.routeTransitionName.value, "shell-route-slide-forward");
  assert.equal(result.routeTransitionKey.value, "/home/bookings");

  page.dispatch("pointerdown", { ...touch, clientX: 100, clientY: 100 });
  page.dispatch("pointermove", { ...touch, clientX: 200, clientY: 102 });

  assert.deepEqual(pushes, ["/home/bookings", "/home/contacts"]);
  assert.equal(result.routeTransitionName.value, "shell-route-slide-reverse");
  app.unmount();
});

test("a route change away from every destination has no motion", (t) => {
  const { app, result, route } = mountTransition(t);

  route.path = "/home/bookings";
  assert.equal(result.routeTransitionName.value, "shell-route-slide-forward");

  route.path = "/away";
  assert.equal(result.routeTransitionName.value, "");
  assert.equal(result.routeTransitionKey.value, "surface:home");
  app.unmount();
});

test("wide layouts keep the pane still and never start a swipe", (t) => {
  const { app, page, pushes, result, route } = mountTransition(t, { displayName: "lg" });
  assert.equal(page.classes.has("shell-route-swipe-enabled"), false);

  page.dispatch("pointerdown", { ...touch, clientX: 300, clientY: 100 });
  page.dispatch("pointermove", { ...touch, clientX: 200, clientY: 102 });
  assert.deepEqual(pushes, []);

  route.path = "/home/bookings";
  assert.equal(result.routeTransitionName.value, "");
  assert.equal(result.routeTransitionKey.value, "surface:home");
  app.unmount();
});

test("a swipe from an interactive control or with swipes off does nothing", (t) => {
  const off = mountTransition(t, { props: { swipeEnabled: false } });
  assert.equal(off.page.classes.has("shell-route-swipe-enabled"), false);
  off.app.unmount();

  const { app, page, pushes } = mountTransition(t);
  page.dispatch("pointerdown", { ...touch, clientX: 300, clientY: 100, target: { closest: () => ({}) } });
  page.dispatch("pointermove", { ...touch, clientX: 200, clientY: 102 });
  assert.deepEqual(pushes, []);
  app.unmount();
});

test("unmounting removes the swipe listeners and the page class", (t) => {
  const { app, page } = mountTransition(t);
  assert.equal(page.listeners.size, 4);

  app.unmount();

  assert.equal(page.listeners.size, 0);
  assert.equal(page.classes.has("shell-route-swipe-enabled"), false);
});
