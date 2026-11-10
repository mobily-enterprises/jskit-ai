import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeComparablePathname,
  resolveActivePrimaryNavigationIndex,
  resolvePrimaryNavigationEntries
} from "../src/client/support/primaryNavigation.js";

const PLACEMENT_CONTEXT = Object.freeze({
  surfaceConfig: {
    defaultSurfaceId: "home",
    enabledSurfaceIds: ["home"],
    surfacesById: {
      home: { id: "home", pagesRoot: "home", routeBase: "/home", enabled: true }
    }
  }
});

function placement(id, props, semanticTarget = "shell.primary-nav") {
  return { id, semanticTarget, props };
}

function resolveEntries(placements) {
  return resolvePrimaryNavigationEntries(placements, {
    semanticTarget: "shell.primary-nav",
    currentSurfaceId: "home",
    placementContext: PLACEMENT_CONTEXT,
    routeParams: {}
  });
}

test("comparable pathnames drop the query and hash outside a browser", () => {
  assert.equal(normalizeComparablePathname(""), "");
  assert.equal(normalizeComparablePathname("/home/settings/?tab=1#top"), "/home/settings");
});

test("comparable pathnames in a browser resolve against the page and refuse other origins", (t) => {
  globalThis.window = { location: { href: "https://app.test/home/", origin: "https://app.test" } };
  t.after(() => {
    delete globalThis.window;
  });

  assert.equal(normalizeComparablePathname("contacts/"), "/home/contacts");
  assert.equal(normalizeComparablePathname("https://app.test/home/?x=1"), "/home");
  assert.equal(normalizeComparablePathname("https://other.test/home"), "");
});

test("primary navigation keeps the target's same-origin destinations in placement order", () => {
  const entries = resolveEntries([
    placement("home", { to: "/home", exact: true }),
    placement("elsewhere", { to: "/home/other" }, "shell.secondary-nav"),
    placement("external", { to: "https://other.test/home" }),
    placement("contacts", { surface: "home", unscopedSuffix: "/contacts", scopedSuffix: "/contacts" })
  ]);

  assert.deepEqual(entries.map((entry) => [entry.id, entry.index, entry.exact, entry.href, entry.pathname]), [
    ["home", 0, true, "/home", "/home"],
    ["contacts", 2, false, "/home/contacts", "/home/contacts"]
  ]);
});

test("primary navigation on a route without surface params reads them from the current pathname", () => {
  const placementContext = {
    surfaceConfig: {
      defaultSurfaceId: "app",
      enabledSurfaceIds: ["app"],
      surfacesById: {
        app: { id: "app", pagesRoot: "w/[workspaceSlug]", routeBase: "/w/:workspaceSlug", enabled: true, requiresWorkspace: true }
      }
    }
  };
  const entries = resolvePrimaryNavigationEntries([
    placement("contacts", { surface: "app", scopedSuffix: "/contacts", unscopedSuffix: "/contacts" })
  ], {
    semanticTarget: "shell.primary-nav",
    currentSurfaceId: "app",
    currentPathname: "/w/acme/no-such-page",
    placementContext,
    routeParams: { pathMatch: ["w", "acme", "no-such-page"] }
  });

  assert.deepEqual(entries.map((entry) => [entry.id, entry.href]), [["contacts", "/w/acme/contacts"]]);
});

test("the active destination is the closest path match", () => {
  const entries = [
    { index: 0, pathname: "/home", exact: false },
    { index: 1, pathname: "/home/settings", exact: false },
    { index: 2, pathname: "/home/exact", exact: true },
    { index: 3, pathname: "/", exact: false }
  ];

  assert.equal(resolveActivePrimaryNavigationIndex("/home/settings/general", entries), 1);
  assert.equal(resolveActivePrimaryNavigationIndex("/home/other", entries), 0);
  assert.equal(resolveActivePrimaryNavigationIndex("/home/exact/child", entries), 0);
  assert.equal(resolveActivePrimaryNavigationIndex("/", entries), 3);
  assert.equal(resolveActivePrimaryNavigationIndex("/away", entries), -1);
});
