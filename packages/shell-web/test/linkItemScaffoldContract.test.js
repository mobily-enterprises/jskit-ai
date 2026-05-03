import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import descriptor from "../package.descriptor.mjs";
import {
  LOCAL_LINK_ITEM_COMPONENT_DEFINITIONS,
  findLocalLinkItemDefinition,
  readLocalLinkItemComponentSource
} from "../src/server/support/localLinkItemScaffolds.js";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

function findFileMutation(id) {
  const files = descriptor?.mutations?.files;
  return Array.isArray(files)
    ? files.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

function findTextMutation(id) {
  const textMutations = descriptor?.mutations?.text;
  return Array.isArray(textMutations)
    ? textMutations.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

test("shell-web exports generic link-item components for app-owned shell wrappers", async () => {
  const clientIndexSource = await readFile(path.join(PACKAGE_DIR, "src", "client", "index.js"), "utf8");
  assert.match(clientIndexSource, /ShellMenuLinkItem/);
  assert.match(clientIndexSource, /ShellSurfaceAwareMenuLinkItem/);
  assert.match(clientIndexSource, /ShellTabLinkItem/);

  const packageJson = JSON.parse(await readFile(path.join(PACKAGE_DIR, "package.json"), "utf8"));
  assert.equal(
    packageJson?.exports?.["./client/components/ShellMenuLinkItem"],
    "./src/client/components/ShellMenuLinkItem.vue"
  );
  assert.equal(
    packageJson?.exports?.["./client/components/ShellSurfaceAwareMenuLinkItem"],
    "./src/client/components/ShellSurfaceAwareMenuLinkItem.vue"
  );
  assert.equal(
    packageJson?.exports?.["./client/components/ShellTabLinkItem"],
    "./src/client/components/ShellTabLinkItem.vue"
  );
  assert.equal(
    packageJson?.exports?.["./server/support/localLinkItemScaffolds"],
    "./src/server/support/localLinkItemScaffolds.js"
  );
});

test("shell-web scaffolds app-owned local link-item wrappers under src/components/menus", async () => {
  const menuWrapperSource = await readFile(
    path.join(PACKAGE_DIR, "templates", "src", "components", "menus", "MenuLinkItem.vue"),
    "utf8"
  );
  const surfaceAwareWrapperSource = await readFile(
    path.join(PACKAGE_DIR, "templates", "src", "components", "menus", "SurfaceAwareMenuLinkItem.vue"),
    "utf8"
  );
  const tabWrapperSource = await readFile(
    path.join(PACKAGE_DIR, "templates", "src", "components", "menus", "TabLinkItem.vue"),
    "utf8"
  );

  assert.match(menuWrapperSource, /@jskit-ai\/shell-web\/client\/components\/ShellMenuLinkItem/);
  assert.match(surfaceAwareWrapperSource, /@jskit-ai\/shell-web\/client\/components\/ShellSurfaceAwareMenuLinkItem/);
  assert.match(tabWrapperSource, /@jskit-ai\/shell-web\/client\/components\/ShellTabLinkItem/);
  assert.match(menuWrapperSource, /exact:\s*\{/);
  assert.match(surfaceAwareWrapperSource, /exact:\s*\{/);
  assert.match(tabWrapperSource, /icon:\s*\{/);

  assert.deepEqual(findFileMutation("shell-web-component-menu-link-item"), {
    from: "templates/src/components/menus/MenuLinkItem.vue",
    to: "src/components/menus/MenuLinkItem.vue",
    ownership: "app",
    reason: "Install app-owned shell menu link-item scaffold for local placement customization.",
    category: "shell-web",
    id: "shell-web-component-menu-link-item"
  });
  assert.deepEqual(findFileMutation("shell-web-component-surface-aware-menu-link-item"), {
    from: "templates/src/components/menus/SurfaceAwareMenuLinkItem.vue",
    to: "src/components/menus/SurfaceAwareMenuLinkItem.vue",
    ownership: "app",
    reason: "Install app-owned surface-aware shell menu link-item scaffold for local placement customization.",
    category: "shell-web",
    id: "shell-web-component-surface-aware-menu-link-item"
  });
  assert.deepEqual(findFileMutation("shell-web-component-tab-link-item"), {
    from: "templates/src/components/menus/TabLinkItem.vue",
    to: "src/components/menus/TabLinkItem.vue",
    ownership: "app",
    reason: "Install app-owned shell tab link-item scaffold for local placement customization.",
    category: "shell-web",
    id: "shell-web-component-tab-link-item"
  });

  assert.deepEqual(
    LOCAL_LINK_ITEM_COMPONENT_DEFINITIONS.map((entry) => ({
      token: entry.token,
      componentFile: entry.componentFile,
      componentName: entry.componentName,
      templateFile: entry.templateFile
    })),
    [
      {
        token: "local.main.ui.menu-link-item",
        componentFile: "src/components/menus/MenuLinkItem.vue",
        componentName: "MenuLinkItem",
        templateFile: "templates/src/components/menus/MenuLinkItem.vue"
      },
      {
        token: "local.main.ui.surface-aware-menu-link-item",
        componentFile: "src/components/menus/SurfaceAwareMenuLinkItem.vue",
        componentName: "SurfaceAwareMenuLinkItem",
        templateFile: "templates/src/components/menus/SurfaceAwareMenuLinkItem.vue"
      },
      {
        token: "local.main.ui.tab-link-item",
        componentFile: "src/components/menus/TabLinkItem.vue",
        componentName: "TabLinkItem",
        templateFile: "templates/src/components/menus/TabLinkItem.vue"
      }
    ]
  );
  assert.equal(findLocalLinkItemDefinition("local.main.ui.tab-link-item")?.componentName, "TabLinkItem");
  assert.equal(await readLocalLinkItemComponentSource("local.main.ui.tab-link-item"), tabWrapperSource);
});

test("shell-web generic link items support the expected shared route and icon behavior", async () => {
  const shellMenuSource = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "components", "ShellMenuLinkItem.vue"),
    "utf8"
  );
  const shellSurfaceAwareSource = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "components", "ShellSurfaceAwareMenuLinkItem.vue"),
    "utf8"
  );
  const shellTabSource = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "components", "ShellTabLinkItem.vue"),
    "utf8"
  );

  assert.match(shellMenuSource, /exact:\s*\{/);
  assert.match(shellMenuSource, /:exact="props\.exact"/);
  assert.match(shellSurfaceAwareSource, /exact:\s*\{/);
  assert.match(shellSurfaceAwareSource, /:exact="props\.exact"/);
  assert.match(shellTabSource, /icon:\s*\{/);
  assert.match(shellTabSource, /resolveMenuLinkIcon/);
  assert.match(shellTabSource, /<v-list-item/);
  assert.match(shellTabSource, /:prepend-icon="resolvedIcon \|\| undefined"/);
});

test("shell-web binds the local link-item wrapper tokens into MainClientProvider", () => {
  assert.deepEqual(findTextMutation("shell-web-main-client-provider-menu-link-item-import"), {
    op: "append-text",
    file: "packages/main/src/client/providers/MainClientProvider.js",
    position: "top",
    skipIfContains: "import MenuLinkItem from \"/src/components/menus/MenuLinkItem.vue\";",
    value: "import MenuLinkItem from \"/src/components/menus/MenuLinkItem.vue\";\n",
    reason: "Bind app-owned shell menu link-item scaffold into local main client provider imports.",
    category: "shell-web",
    id: "shell-web-main-client-provider-menu-link-item-import"
  });
  assert.deepEqual(findTextMutation("shell-web-main-client-provider-surface-aware-menu-link-item-import"), {
    op: "append-text",
    file: "packages/main/src/client/providers/MainClientProvider.js",
    position: "top",
    skipIfContains: "import SurfaceAwareMenuLinkItem from \"/src/components/menus/SurfaceAwareMenuLinkItem.vue\";",
    value: "import SurfaceAwareMenuLinkItem from \"/src/components/menus/SurfaceAwareMenuLinkItem.vue\";\n",
    reason: "Bind app-owned shell surface-aware menu link-item scaffold into local main client provider imports.",
    category: "shell-web",
    id: "shell-web-main-client-provider-surface-aware-menu-link-item-import"
  });
  assert.deepEqual(findTextMutation("shell-web-main-client-provider-tab-link-item-import"), {
    op: "append-text",
    file: "packages/main/src/client/providers/MainClientProvider.js",
    position: "top",
    skipIfContains: "import TabLinkItem from \"/src/components/menus/TabLinkItem.vue\";",
    value: "import TabLinkItem from \"/src/components/menus/TabLinkItem.vue\";\n",
    reason: "Bind app-owned shell tab link-item scaffold into local main client provider imports.",
    category: "shell-web",
    id: "shell-web-main-client-provider-tab-link-item-import"
  });
  assert.deepEqual(findTextMutation("shell-web-main-client-provider-menu-link-item-register"), {
    op: "append-text",
    file: "packages/main/src/client/providers/MainClientProvider.js",
    position: "bottom",
    skipIfContains: "registerMainClientComponent(\"local.main.ui.menu-link-item\", () => MenuLinkItem);",
    value: "\nregisterMainClientComponent(\"local.main.ui.menu-link-item\", () => MenuLinkItem);\n",
    reason: "Bind app-owned shell menu link-item token into local main client provider registry.",
    category: "shell-web",
    id: "shell-web-main-client-provider-menu-link-item-register"
  });
  assert.deepEqual(findTextMutation("shell-web-main-client-provider-surface-aware-menu-link-item-register"), {
    op: "append-text",
    file: "packages/main/src/client/providers/MainClientProvider.js",
    position: "bottom",
    skipIfContains: "registerMainClientComponent(\"local.main.ui.surface-aware-menu-link-item\", () => SurfaceAwareMenuLinkItem);",
    value: "\nregisterMainClientComponent(\"local.main.ui.surface-aware-menu-link-item\", () => SurfaceAwareMenuLinkItem);\n",
    reason: "Bind app-owned shell surface-aware menu link-item token into local main client provider registry.",
    category: "shell-web",
    id: "shell-web-main-client-provider-surface-aware-menu-link-item-register"
  });
  assert.deepEqual(findTextMutation("shell-web-main-client-provider-tab-link-item-register"), {
    op: "append-text",
    file: "packages/main/src/client/providers/MainClientProvider.js",
    position: "bottom",
    skipIfContains: "registerMainClientComponent(\"local.main.ui.tab-link-item\", () => TabLinkItem);",
    value: "\nregisterMainClientComponent(\"local.main.ui.tab-link-item\", () => TabLinkItem);\n",
    reason: "Bind app-owned shell tab link-item token into local main client provider registry.",
    category: "shell-web",
    id: "shell-web-main-client-provider-tab-link-item-register"
  });
});
