import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  deriveDefaultSubpagesHost,
  normalizePagesRelativeTargetRoot,
  resolvePageLinkTargetDetails,
  resolvePageTargetDetails
} from "./pageTargets.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "kernel-page-targets-"));
  try {
    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

async function writeFileInApp(appRoot, relativePath, source) {
  const absoluteFile = path.join(appRoot, relativePath);
  await mkdir(path.dirname(absoluteFile), { recursive: true });
  await writeFile(absoluteFile, source, "utf8");
}

async function writeConfig(appRoot, source) {
  await writeFileInApp(appRoot, "config/public.js", source);
}

async function writeShellLayout(appRoot, source = "") {
  await writeFileInApp(
    appRoot,
    "src/components/ShellLayout.vue",
    source ||
      `<template>
  <div>
    <ShellOutlet target="shell-layout:top-right" />
    <ShellOutlet
      target="shell-layout:primary-menu"
      default
      default-link-component-token="local.main.ui.surface-aware-menu-link-item"
    />
  </div>
</template>
`
  );
}

test("resolvePageTargetDetails derives the surface and route data from an explicit page file", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true }
  }
};
`
    );

    const pageTarget = await resolvePageTargetDetails({
      appRoot,
      targetFile: "w/[workspaceSlug]/admin/catalog/index/products/index.vue",
      context: "page target"
    });

    assert.equal(pageTarget.surfaceId, "admin");
    assert.equal(pageTarget.surfacePagesRoot, "w/[workspaceSlug]/admin");
    assert.equal(pageTarget.routeUrlSuffix, "/catalog/products");
    assert.equal(pageTarget.placementId, "ui-generator.page.admin.catalog.products.link");
    assert.deepEqual(pageTarget.visibleRouteSegments, ["catalog", "products"]);
    assert.equal(deriveDefaultSubpagesHost(pageTarget), "catalog-products");
  });
});

test("resolvePageTargetDetails includes surface in placement ids for identical routes on different surfaces", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    app: { id: "app", pagesRoot: "app", enabled: true },
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );

    const appPageTarget = await resolvePageTargetDetails({
      appRoot,
      targetFile: "app/reports/index.vue",
      context: "page target"
    });
    const adminPageTarget = await resolvePageTargetDetails({
      appRoot,
      targetFile: "admin/reports/index.vue",
      context: "page target"
    });

    assert.equal(appPageTarget.placementId, "ui-generator.page.app.reports.link");
    assert.equal(adminPageTarget.placementId, "ui-generator.page.admin.reports.link");
    assert.notEqual(appPageTarget.placementId, adminPageTarget.placementId);
  });
});

test("resolvePageTargetDetails chooses the most specific matching surface pagesRoot", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    app: { id: "app", pagesRoot: "w/[workspaceSlug]", enabled: true },
    admin: { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true }
  }
};
`
    );

    const pageTarget = await resolvePageTargetDetails({
      appRoot,
      targetFile: "w/[workspaceSlug]/admin/catalog/index.vue",
      context: "page target"
    });

    assert.equal(pageTarget.surfaceId, "admin");
    assert.equal(pageTarget.surfacePagesRoot, "w/[workspaceSlug]/admin");
    assert.equal(pageTarget.surfaceRelativeFilePath, "catalog/index.vue");
    assert.equal(pageTarget.routeUrlSuffix, "/catalog");
    assert.equal(pageTarget.placementId, "ui-generator.page.admin.catalog.link");
  });
});

test("resolvePageTargetDetails derives surface auth requirement from surface access policy", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceAccessPolicies: {
    public: {},
    authenticated: {
      requireAuth: true
    }
  },
  surfaceDefinitions: {
    home: { id: "home", pagesRoot: "home", enabled: true, accessPolicyId: "public" },
    app: { id: "app", pagesRoot: "app", enabled: true, accessPolicyId: "authenticated" }
  }
};
`
    );

    const publicPageTarget = await resolvePageTargetDetails({
      appRoot,
      targetFile: "home/index.vue",
      context: "page target"
    });
    const authenticatedPageTarget = await resolvePageTargetDetails({
      appRoot,
      targetFile: "app/index.vue",
      context: "page target"
    });

    assert.equal(publicPageTarget.surfaceRequiresAuth, false);
    assert.equal(authenticatedPageTarget.surfaceRequiresAuth, true);
  });
});

test("resolvePageTargetDetails rejects duplicate matching surface pagesRoot definitions", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    adminA: { id: "admin-a", pagesRoot: "w/[workspaceSlug]/admin", enabled: true },
    adminB: { id: "admin-b", pagesRoot: "w/[workspaceSlug]/admin", enabled: true }
  }
};
`
    );

    await assert.rejects(
      () =>
        resolvePageTargetDetails({
          appRoot,
          targetFile: "w/[workspaceSlug]/admin/catalog/index.vue",
          context: "page target"
        }),
      /multiple surfaces share pagesRoot "w\/\[workspaceSlug\]\/admin" \(admin-a, admin-b\)/
    );
  });
});

test("resolvePageTargetDetails rejects target files with a src/pages prefix", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );

    await assert.rejects(
      () =>
        resolvePageTargetDetails({
          appRoot,
          targetFile: "src/pages/admin/reports/index.vue",
          context: "page target"
        }),
      /must be relative to src\/pages\/, without the src\/pages\/ prefix/
    );
  });
});

test("normalizePagesRelativeTargetRoot rejects route roots with a src/pages prefix", () => {
  assert.throws(
    () =>
      normalizePagesRelativeTargetRoot("src/pages/admin/customers", {
        context: "crud-ui-generator",
        label: 'option "target-root"'
      }),
    /must be relative to src\/pages\/, without the src\/pages\/ prefix/
  );
});

test("resolvePageLinkTargetDetails falls back to the app default placement target", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const details = await resolvePageLinkTargetDetails({
      appRoot,
      targetFile: "admin/reports/index.vue",
      context: "page target"
    });

    assert.equal(details.pageTarget.surfaceId, "admin");
    assert.equal(details.placementTarget.id, "shell-layout:primary-menu");
    assert.equal(details.componentToken, "local.main.ui.surface-aware-menu-link-item");
    assert.equal(details.linkTo, "");
    assert.equal(details.whenLine, "");
  });
});

test("resolvePageLinkTargetDetails emits an auth guard when the surface policy requires auth", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceAccessPolicies: {
    authenticated: {
      requireAuth: true
    }
  },
  surfaceDefinitions: {
    app: { id: "app", pagesRoot: "app", enabled: true, accessPolicyId: "authenticated" }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const details = await resolvePageLinkTargetDetails({
      appRoot,
      targetFile: "app/reports/index.vue",
      context: "page target"
    });

    assert.equal(details.whenLine, "    when: ({ auth }) => Boolean(auth?.authenticated)\n");
  });
});

test("resolvePageLinkTargetDetails prefers an outlet-declared default link token over subpage heuristics", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    home: { id: "home", pagesRoot: "home", enabled: true }
  }
};
`
    );
    await writeFileInApp(
      appRoot,
      "src/pages/home/settings.vue",
      `<template>
  <section>
    <ShellOutlet
      target="home-settings:primary-menu"
      default-link-component-token="local.main.ui.surface-aware-menu-link-item"
    />
    <RouterView />
  </section>
</template>
`
    );

    const details = await resolvePageLinkTargetDetails({
      appRoot,
      targetFile: "home/settings/pollen-types/index.vue",
      context: "page target"
    });

    assert.equal(details.parentHost?.id, "home-settings:primary-menu");
    assert.equal(details.placementTarget.id, "home-settings:primary-menu");
    assert.equal(details.componentToken, "local.main.ui.surface-aware-menu-link-item");
    assert.equal(details.linkTo, "./pollen-types");
  });
});

test("resolvePageLinkTargetDetails inherits a file-route parent subpages host", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/contacts/[contactId].vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="contact-view:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const details = await resolvePageLinkTargetDetails({
      appRoot,
      targetFile: "admin/contacts/[contactId]/notes/index.vue",
      context: "page target"
    });

    assert.equal(details.parentHost?.id, "contact-view:sub-pages");
    assert.equal(details.placementTarget.id, "contact-view:sub-pages");
    assert.equal(details.componentToken, "local.main.ui.tab-link-item");
    assert.equal(details.linkTo, "./notes");
  });
});

test("resolvePageLinkTargetDetails honors explicit placement and link overrides", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const details = await resolvePageLinkTargetDetails({
      appRoot,
      targetFile: "admin/contacts/[contactId]/index/notes/index.vue",
      placement: "shell-layout:top-right",
      componentToken: "custom.link-item",
      linkTo: "./assistant-notes",
      context: "page target"
    });

    assert.equal(details.placementTarget.id, "shell-layout:top-right");
    assert.equal(details.componentToken, "custom.link-item");
    assert.equal(details.linkTo, "./assistant-notes");
  });
});

test("resolvePageLinkTargetDetails inherits an index-route parent subpages host for index children", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/customers/[customerId]/index.vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="customer-view:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const details = await resolvePageLinkTargetDetails({
      appRoot,
      targetFile: "admin/customers/[customerId]/index/pets/index.vue",
      context: "page target"
    });

    assert.equal(details.parentHost?.id, "customer-view:sub-pages");
    assert.equal(details.parentHost?.pageFile, "src/pages/admin/customers/[customerId]/index.vue");
    assert.equal(details.placementTarget.id, "customer-view:sub-pages");
    assert.equal(details.componentToken, "local.main.ui.tab-link-item");
    assert.equal(details.linkTo, "./pets");
  });
});
