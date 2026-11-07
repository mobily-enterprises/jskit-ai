import assert from "node:assert/strict";
import test from "node:test";
import { createApp, ref } from "vue";
import { resolveShellLinkPath, useShellLinkResolver } from "../src/client/navigation/linkResolver.js";
import { usePaths } from "../src/client/navigation/usePaths.js";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "../src/client/placement/inject.js";

function createPlacementContext() {
  return {
    surfaceConfig: {
      tenancyMode: "workspaces",
      defaultSurfaceId: "app",
      enabledSurfaceIds: ["app", "admin", "console"],
      surfacesById: {
        app: {
          id: "app",
          pagesRoot: "w/[workspaceSlug]",
          routeBase: "/w/:workspaceSlug",
          enabled: true,
          requiresWorkspace: true
        },
        admin: {
          id: "admin",
          pagesRoot: "admin",
          routeBase: "/admin",
          enabled: true,
          requiresWorkspace: true
        },
        console: {
          id: "console",
          pagesRoot: "console",
          routeBase: "/console",
          enabled: true,
          requiresWorkspace: false
        }
      }
    }
  };
}

test("resolveShellLinkPath composes surface path for workspace-labeled surfaces", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "admin",
    relativePath: "/contacts/2"
  });

  assert.equal(to, "/admin/contacts/2");
});

test("resolveShellLinkPath materializes dynamic route params from params map", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "app",
    params: {
      workspaceSlug: "acme"
    },
    relativePath: "/projects/2"
  });

  assert.equal(to, "/w/acme/projects/2");
});

test("resolveShellLinkPath fails when required route params are missing", () => {
  assert.throws(
    () =>
      resolveShellLinkPath({
        context: createPlacementContext(),
        surface: "app",
        relativePath: "/projects/2"
      }),
    /Missing required surface route params/
  );
});

test("resolveShellLinkPath composes non-workspace path for non-workspace surface", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "console",
    relativePath: "/contacts"
  });

  assert.equal(to, "/console/contacts");
});

test("resolveShellLinkPath keeps explicit target unchanged", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "admin",
    explicitTo: "/custom/path"
  });

  assert.equal(to, "/custom/path");
});

test("resolveShellLinkPath prefers surfaceRelativePath when provided", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "admin",
    relativePath: "/ignored",
    surfaceRelativePath: "/contacts"
  });

  assert.equal(to, "/admin/contacts");
});

test("resolveShellLinkPath uses deterministic surface fallback when context is missing", () => {
  const to = resolveShellLinkPath({
    context: null,
    surface: "admin",
    relativePath: "/contacts/5"
  });

  assert.equal(to, "/admin/contacts/5");
});

test("resolveShellLinkPath uses the first value of a repeated route param", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "app",
    params: {
      workspaceSlug: [" acme ", "other"]
    },
    relativePath: "/projects"
  });

  assert.equal(to, "/w/acme/projects");
});

test("useShellLinkResolver exposes only surface-relative resolve", () => {
  const app = createApp({ render: () => null });
  const resolver = app.runWithContext(() => useShellLinkResolver({ surface: "console" }));

  assert.deepEqual(Object.keys(resolver), ["resolve"]);
  assert.equal(resolver.resolve("/reports"), "/console/reports");
});

test("resolveShellLinkPath fills the relative path's :name segments from params", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "app",
    params: { workspaceSlug: "acme", proposalId: "7 b" },
    relativePath: "/program/proposal/:proposalId/edit"
  });

  assert.equal(to, "/w/acme/program/proposal/7%20b/edit");
});

test("resolveShellLinkPath throws for a relative path's missing param unless params are not strict", () => {
  const link = { context: createPlacementContext(), surface: "console", relativePath: "/books/:bookId" };
  assert.throws(() => resolveShellLinkPath(link), /Missing required route params for "\/books\/:bookId": bookId\./u);
  assert.equal(resolveShellLinkPath({ ...link, strictParams: false }), "/console/books/:bookId");
});

test("resolveShellLinkPath leaves an external URL, a query and a hash alone", () => {
  const context = createPlacementContext();
  assert.equal(
    resolveShellLinkPath({ context, surface: "console", relativePath: "https://example.com:8080/:x" }),
    "https://example.com:8080/:x"
  );
  assert.equal(
    resolveShellLinkPath({ context, surface: "console", relativePath: "/search?at=:time#:part", params: { time: "now" } }),
    "/console/search?at=:time#:part"
  );
});

test("usePaths().page() fills a declared parent's params from the current route", () => {
  const context = createPlacementContext();
  const app = createApp({ render: () => null });
  app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, { getContext: () => context, subscribe: () => () => {} });
  const paths = app.runWithContext(() => usePaths({
    routeContext: {
      route: { params: { bookId: "7" } },
      placementContext: ref(context),
      currentSurfaceId: ref("console")
    }
  }));

  // What the Up arrow of a direct visit to /console/books/7/edit resolves its parent "/books/:bookId" to.
  assert.equal(paths.page("/books/:bookId"), "/console/books/7");
  assert.equal(paths.page("/books/:bookId", { params: { bookId: "8" } }), "/console/books/8");
  assert.throws(() => paths.page("/authors/:authorId"), /Missing required route params/u);
  // A global route belongs to no surface: its app path, its params filled the same way.
  assert.equal(paths.page("/auth/login", { scope: "global" }), "/auth/login");
  assert.equal(paths.page("/shared/:bookId", { scope: "global" }), "/shared/7");
  assert.throws(() => paths.page("/shared/:authorId", { scope: "global" }), /Missing required route params/u);
});
