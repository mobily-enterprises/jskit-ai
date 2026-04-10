import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  deriveDefaultSubpagesHost,
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
    <ShellOutlet host="shell-layout" position="top-right" />
    <ShellOutlet host="shell-layout" position="primary-menu" default />
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
      targetFile: "src/pages/w/[workspaceSlug]/admin/catalog/(nestedChildren)/products/index.vue",
      context: "page target"
    });

    assert.equal(pageTarget.surfaceId, "admin");
    assert.equal(pageTarget.surfacePagesRoot, "w/[workspaceSlug]/admin");
    assert.equal(pageTarget.routeUrlSuffix, "/catalog/products");
    assert.equal(pageTarget.placementId, "ui-generator.page.catalog.products.link");
    assert.deepEqual(pageTarget.visibleRouteSegments, ["catalog", "products"]);
    assert.equal(deriveDefaultSubpagesHost(pageTarget), "catalog-products");
  });
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
      targetFile: "src/pages/admin/reports/index.vue",
      context: "page target"
    });

    assert.equal(details.pageTarget.surfaceId, "admin");
    assert.equal(details.placementTarget.host, "shell-layout");
    assert.equal(details.placementTarget.position, "primary-menu");
    assert.equal(details.componentToken, "users.web.shell.surface-aware-menu-link-item");
    assert.equal(details.linkTo, "");
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
      <ShellOutlet host="contact-view" position="sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const details = await resolvePageLinkTargetDetails({
      appRoot,
      targetFile: "src/pages/admin/contacts/[contactId]/notes/index.vue",
      context: "page target"
    });

    assert.equal(details.parentHost?.id, "contact-view:sub-pages");
    assert.equal(details.placementTarget.host, "contact-view");
    assert.equal(details.placementTarget.position, "sub-pages");
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
      targetFile: "src/pages/admin/contacts/[contactId]/(nestedChildren)/notes/index.vue",
      placement: "shell-layout:top-right",
      componentToken: "custom.link-item",
      linkTo: "./assistant-notes",
      context: "page target"
    });

    assert.equal(details.placementTarget.host, "shell-layout");
    assert.equal(details.placementTarget.position, "top-right");
    assert.equal(details.componentToken, "custom.link-item");
    assert.equal(details.linkTo, "./assistant-notes");
  });
});
