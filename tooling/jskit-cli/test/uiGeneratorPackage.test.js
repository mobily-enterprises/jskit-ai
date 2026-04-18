import assert from "node:assert/strict";
import { access, constants as fsConstants, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";
import { writeInstalledPackagesLock } from "./testLock.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CRUD_UI_GENERATOR_SOURCE_ROOT = path.join(REPO_ROOT, "packages", "crud-ui-generator");
const CRUD_CORE_SOURCE_ROOT = path.join(REPO_ROOT, "packages", "crud-core");
const KERNEL_SOURCE_ROOT = path.join(REPO_ROOT, "packages", "kernel");
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot, { name = "tmp-app" } = {}) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await mkdir(path.join(appRoot, "src", "components"), { recursive: true });
  await mkdir(path.join(appRoot, "packages", "main", "src", "client", "providers"), { recursive: true });

  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: "0.1.0",
        private: true,
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(appRoot, "config", "public.js"),
    `const config = {
  tenancyMode: "workspaces",
  surfaceDefaultId: "admin",
  surfaceDefinitions: {
    admin: {
      id: "admin",
      pagesRoot: "admin",
      enabled: true,
      requiresAuth: true,
      requiresWorkspace: true
    }
  }
};

export default config;
export { config };
`,
    "utf8"
  );

  await writeFile(
    path.join(appRoot, "src", "placement.js"),
    `function addPlacement() {}

export { addPlacement };
export default function getPlacements() {
  return [];
}
`,
    "utf8"
  );

  await writeFile(
    path.join(appRoot, "src", "components", "ShellLayout.vue"),
    `<template>
  <div>
    <ShellOutlet target="shell-layout:top-left" />
    <ShellOutlet target="shell-layout:top-right" />
    <ShellOutlet
      target="shell-layout:primary-menu"
      default
      default-link-component-token="local.main.ui.surface-aware-menu-link-item"
    />
    <ShellOutlet
      target="shell-layout:secondary-menu"
      default-link-component-token="local.main.ui.surface-aware-menu-link-item"
    />
  </div>
</template>
`,
    "utf8"
  );

  await writeFile(
    path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js"),
    `const mainClientComponents = [];

function registerMainClientComponent(componentToken, resolveComponent) {
  const token = String(componentToken || "").trim();
  if (!token || typeof resolveComponent !== "function") {
    return;
  }
  mainClientComponents.push(
    Object.freeze({
      token,
      resolveComponent
    })
  );
}

class MainClientProvider {
  static id = "local.main.client";
}

export {
  MainClientProvider,
  registerMainClientComponent
};
`,
    "utf8"
  );

  await writeInstalledPackagesLock(appRoot, {
    "@jskit-ai/shell-web": {
      packageId: "@jskit-ai/shell-web",
      version: "0.1.0"
    }
  });
}

async function installCrudUiGeneratorPackage(appRoot) {
  const scopedRoot = path.join(appRoot, "node_modules", "@jskit-ai");
  const packageRoot = path.join(scopedRoot, "crud-ui-generator");
  const crudCoreRoot = path.join(scopedRoot, "crud-core");
  const kernelRoot = path.join(scopedRoot, "kernel");
  await mkdir(path.dirname(packageRoot), { recursive: true });
  await cp(CRUD_UI_GENERATOR_SOURCE_ROOT, packageRoot, { recursive: true });
  await cp(CRUD_CORE_SOURCE_ROOT, crudCoreRoot, { recursive: true });
  await cp(KERNEL_SOURCE_ROOT, kernelRoot, { recursive: true });
}

async function writeCustomerResource(appRoot, { includeResourceNamespace = true } = {}) {
  const resourceFile = path.join(appRoot, "packages", "customers", "src", "shared", "customerResource.js");
  await mkdir(path.dirname(resourceFile), { recursive: true });
  await writeFile(
    resourceFile,
    `const customerRecordSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    firstName: { type: "string" },
    email: { type: "string" },
    vip: { type: "boolean" }
  },
  additionalProperties: false
};

const customerBodySchema = {
  type: "object",
  properties: {
    firstName: { type: "string", maxLength: 120 },
    email: { type: "string", maxLength: 160 },
    vip: { type: "boolean" }
  },
  additionalProperties: false
};

const resource = {
${includeResourceNamespace ? '  resource: "customers",\n' : ""}  operations: {
    list: {
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: customerRecordSchema
            },
            nextCursor: { type: ["string", "null"] }
          },
          additionalProperties: false
        }
      }
    },
    view: {
      outputValidator: {
        schema: customerRecordSchema
      }
    },
    create: {
      bodyValidator: {
        schema: customerBodySchema
      },
      outputValidator: {
        schema: customerRecordSchema
      }
    },
    patch: {
      bodyValidator: {
        schema: customerBodySchema
      },
      outputValidator: {
        schema: customerRecordSchema
      }
    }
  }
};

export { resource };
`,
    "utf8"
  );
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveGeneratedPaths(appRoot, targetRoot, idParam = "customerId") {
  const generatedRoot = path.join(appRoot, "src", "pages", targetRoot);
  return {
    generatedRoot,
    listPagePath: path.join(generatedRoot, "index.vue"),
    viewPagePath: path.join(generatedRoot, `[${idParam}]`, "index.vue"),
    newPagePath: path.join(generatedRoot, "new.vue"),
    editPagePath: path.join(generatedRoot, `[${idParam}]`, "edit.vue"),
    addEditFormPath: path.join(generatedRoot, "_components", "CrudAddEditForm.vue"),
    addEditFormFieldsPath: path.join(generatedRoot, "_components", "CrudAddEditFormFields.js")
  };
}

async function generateCrudUiPackage(
  appRoot,
  {
    targetRoot = "admin/ops/customers-ui",
    operations = "list,view,new,edit",
    displayFields = "",
    idParam = "customerId",
    linkPlacement = "",
    namespace = "",
    force = false
  } = {}
) {
  await installCrudUiGeneratorPackage(appRoot);
  const args = [
    "generate",
    "@jskit-ai/crud-ui-generator",
    "crud",
    targetRoot,
    "--resource-file",
    "packages/customers/src/shared/customerResource.js",
    "--id-param",
    idParam,
    ...(operations ? ["--operations", operations] : []),
    ...(displayFields ? ["--display-fields", displayFields] : []),
    ...(linkPlacement ? ["--link-placement", linkPlacement] : []),
    ...(namespace ? ["--namespace", namespace] : []),
    ...(force ? ["--force"] : [])
  ];

  const result = runCli({
    cwd: appRoot,
    args
  });
  assert.equal(result.status, 0, String(result.stderr || ""));
}

test("generate @jskit-ai/crud-ui-generator crud scaffolds CRUD pages at an explicit target-root", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-explicit-root");
    await createMinimalApp(appRoot, { name: "crud-ui-explicit-root" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot);

    const paths = resolveGeneratedPaths(appRoot, "admin/ops/customers-ui");
    assert.equal(await fileExists(paths.listPagePath), true);
    assert.equal(await fileExists(paths.viewPagePath), true);
    assert.equal(await fileExists(paths.newPagePath), true);
    assert.equal(await fileExists(paths.editPagePath), true);
    assert.equal(await fileExists(paths.addEditFormPath), true);
    assert.equal(await fileExists(paths.addEditFormFieldsPath), true);

    const listPageSource = await readFile(paths.listPagePath, "utf8");
    assert.match(listPageSource, /Manage Customers\./);
    assert.match(listPageSource, /import \{ resource as uiResource \} from "\/packages\/customers\/src\/shared\/customerResource\.js";/);
    assert.match(listPageSource, /const UI_LIST_API_URL = "\/customers";/);
    assert.match(listPageSource, /const UI_RECORD_ID_PARAM = "customerId";/);
    assert.match(listPageSource, /"ui-generator", "customers", "list"/);
    assert.doesNotMatch(listPageSource, /<th>Id<\/th>/);
    assert.doesNotMatch(listPageSource, /<td>\{\{ record\.id \}\}<\/td>/);

    const newPageSource = await readFile(paths.newPagePath, "utf8");
    assert.match(newPageSource, /import CrudAddEditForm from "\.\/_components\/CrudAddEditForm\.vue";/);
    assert.match(newPageSource, /UI_CREATE_FORM_FIELDS/);
    assert.match(newPageSource, /jskit:crud-ui-form-fields-target \.\/_components\/CrudAddEditFormFields\.js/);

    const addEditFormFieldsSource = await readFile(paths.addEditFormFieldsPath, "utf8");
    assert.match(addEditFormFieldsSource, /crud\.ui\.form-fields\.customers\.new\.v1/);

    const editPageSource = await readFile(paths.editPagePath, "utf8");
    assert.match(editPageSource, /import CrudAddEditForm from "\.\.\/_components\/CrudAddEditForm\.vue";/);
    assert.match(editPageSource, /jskit:crud-ui-form-fields-target \.\.\/_components\/CrudAddEditFormFields\.js/);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /jskit:crud-ui-generator\.page\.link:admin:\/ops\/customers-ui/);
    assert.match(placementSource, /id: "ui-generator\.page\.admin\.ops\.customers-ui\.link"/);
    assert.match(placementSource, /target: "shell-layout:primary-menu"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.surface-aware-menu-link-item"/);
    assert.match(placementSource, /scopedSuffix: "\/ops\/customers-ui"/);

    const localLinkComponentPath = path.join(appRoot, "src", "components", "menus", "SurfaceAwareMenuLinkItem.vue");
    const providerPath = path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js");
    assert.equal(await fileExists(localLinkComponentPath), true);

    const providerSource = await readFile(providerPath, "utf8");
    assert.match(providerSource, /import SurfaceAwareMenuLinkItem from "\/src\/components\/menus\/SurfaceAwareMenuLinkItem\.vue";/);
    assert.match(
      providerSource,
      /registerMainClientComponent\("local\.main\.ui\.surface-aware-menu-link-item", \(\) => SurfaceAwareMenuLinkItem\);/
    );
  });
});

test("generate @jskit-ai/crud-ui-generator defaults operations to the full CRUD set when omitted", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-default-operations");
    await createMinimalApp(appRoot, { name: "crud-ui-default-operations" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, {
      targetRoot: "admin/products",
      operations: ""
    });

    const paths = resolveGeneratedPaths(appRoot, "admin/products");
    assert.equal(await fileExists(paths.listPagePath), true);
    assert.equal(await fileExists(paths.viewPagePath), true);
    assert.equal(await fileExists(paths.newPagePath), true);
    assert.equal(await fileExists(paths.editPagePath), true);
    assert.equal(await fileExists(paths.addEditFormPath), true);
    assert.equal(await fileExists(paths.addEditFormFieldsPath), true);
  });
});

test("generate @jskit-ai/crud-ui-generator derives the CRUD api path from resource.resource", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-resource-namespace");
    await createMinimalApp(appRoot, { name: "crud-ui-resource-namespace" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, {
      targetRoot: "admin/customers"
    });

    const listPageSource = await readFile(path.join(appRoot, "src/pages/admin/customers/index.vue"), "utf8");
    assert.match(listPageSource, /const UI_LIST_API_URL = "\/customers";/);
  });
});

test("generate @jskit-ai/crud-ui-generator falls back to the target-root leaf when resource.resource is missing", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-leaf-namespace");
    await createMinimalApp(appRoot, { name: "crud-ui-leaf-namespace" });
    await writeCustomerResource(appRoot, { includeResourceNamespace: false });
    await generateCrudUiPackage(appRoot, {
      targetRoot: "admin/catalog/products"
    });

    const listPageSource = await readFile(path.join(appRoot, "src/pages/admin/catalog/products/index.vue"), "utf8");
    assert.match(listPageSource, /const UI_LIST_API_URL = "\/products";/);
    assert.match(listPageSource, /return "Products";/);
  });
});

test("generate @jskit-ai/crud-ui-generator applies display-fields filters to generated pages", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-display-fields");
    await createMinimalApp(appRoot, { name: "crud-ui-display-fields" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, {
      displayFields: "firstName,email"
    });

    const listPageSource = await readFile(path.join(appRoot, "src/pages/admin/ops/customers-ui/index.vue"), "utf8");
    assert.match(listPageSource, /<th>First Name<\/th>/);
    assert.match(listPageSource, /<th>Email<\/th>/);
    assert.doesNotMatch(listPageSource, /<th>Id<\/th>/);
    assert.doesNotMatch(listPageSource, /<th>Vip<\/th>/);
  });
});

test("generate @jskit-ai/crud-ui-generator provisions a referenced local link-item token even when the placement already exists", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-existing-home-settings-placement");
    await createMinimalApp(appRoot, { name: "crud-ui-existing-home-settings-placement" });
    await writeCustomerResource(appRoot);

    await writeFile(
      path.join(appRoot, "config", "public.js"),
      `const config = {
  tenancyMode: "none",
  surfaceDefaultId: "home",
  surfaceDefinitions: {
    home: {
      id: "home",
      pagesRoot: "home",
      enabled: true,
      requiresAuth: true,
      requiresWorkspace: false
    }
  }
};

export default config;
export { config };
`,
      "utf8"
    );

    await mkdir(path.join(appRoot, "src", "pages", "home", "settings"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "settings.vue"),
      `<template>
  <section>
    <v-list>
      <ShellOutlet
        target="home-settings:primary-menu"
        default-link-component-token="local.main.ui.surface-aware-menu-link-item"
      />
    </v-list>
    <RouterView />
  </section>
</template>
`,
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "settings", "index.vue"),
      "<template>\n  <div>Settings</div>\n</template>\n",
      "utf8"
    );

    await writeFile(
      path.join(appRoot, "src", "placement.js"),
      `function addPlacement() {}

// jskit:crud-ui-generator.page.link:home:/settings/pollen_types
{
  addPlacement({
    id: "ui-generator.page.home.settings.pollen-types.link",
    target: "home-settings:primary-menu",
    surfaces: ["home"],
    order: 155,
    componentToken: "local.main.ui.surface-aware-menu-link-item",
    props: {
      label: "Pollen Types",
      surface: "home",
      scopedSuffix: "/settings/pollen_types",
      unscopedSuffix: "/settings/pollen_types",
      to: "./pollen_types"
    }
  });
}

export { addPlacement };
export default function getPlacements() {
  return [];
}
`,
      "utf8"
    );

    await generateCrudUiPackage(appRoot, {
      targetRoot: "home/settings/pollen_types"
    });

    const localLinkComponentPath = path.join(appRoot, "src", "components", "menus", "SurfaceAwareMenuLinkItem.vue");
    const providerPath = path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js");
    assert.equal(await fileExists(localLinkComponentPath), true);

    const providerSource = await readFile(providerPath, "utf8");
    assert.match(providerSource, /import SurfaceAwareMenuLinkItem from "\/src\/components\/menus\/SurfaceAwareMenuLinkItem\.vue";/);
    assert.match(
      providerSource,
      /registerMainClientComponent\("local\.main\.ui\.surface-aware-menu-link-item", \(\) => SurfaceAwareMenuLinkItem\);/
    );
  });
});

test("generate @jskit-ai/crud-ui-generator infers tab placement and relative to from a parent subpages host", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-parent-host");
    await createMinimalApp(appRoot, { name: "crud-ui-parent-host" });
    await writeCustomerResource(appRoot);
    await mkdir(path.join(appRoot, "src", "pages", "admin", "catalog"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "admin", "catalog", "index.vue"),
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="catalog:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`,
      "utf8"
    );

    await generateCrudUiPackage(appRoot, {
      targetRoot: "admin/catalog/index/products"
    });

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /target: "catalog:sub-pages"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.tab-link-item"/);
    assert.match(placementSource, /to: "\.\/products"/);
  });
});

test("generate @jskit-ai/crud-ui-generator honors explicit link-placement overrides", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-link-placement");
    await createMinimalApp(appRoot, { name: "crud-ui-link-placement" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, {
      operations: "list",
      linkPlacement: "shell-layout:secondary-menu"
    });

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /target: "shell-layout:secondary-menu"/);
  });
});

test("generate @jskit-ai/crud-ui-generator list-only scaffolds just the list page and placement", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-list-only");
    await createMinimalApp(appRoot, { name: "crud-ui-list-only" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, {
      operations: "list"
    });

    const paths = resolveGeneratedPaths(appRoot, "admin/ops/customers-ui");
    assert.equal(await fileExists(paths.listPagePath), true);
    assert.equal(await fileExists(paths.viewPagePath), false);
    assert.equal(await fileExists(paths.newPagePath), false);
    assert.equal(await fileExists(paths.editPagePath), false);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /crud-ui-generator\.page\.link:admin:\/ops\/customers-ui/);
  });
});

test("generate @jskit-ai/crud-ui-generator refuses a non-empty existing target root without --force", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-existing-target-root");
    await createMinimalApp(appRoot, { name: "crud-ui-existing-target-root" });
    await writeCustomerResource(appRoot);
    await installCrudUiGeneratorPackage(appRoot);
    await mkdir(path.join(appRoot, "src/pages/admin/products"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src/pages/admin/products/index.vue"),
      `<template>
  <div>custom products page</div>
</template>
`,
      "utf8"
    );
    const lockPath = path.join(appRoot, ".jskit", "lock.json");
    const lockBefore = await readFile(lockPath, "utf8");

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/crud-ui-generator",
        "crud",
        "admin/products",
        "--resource-file",
        "packages/customers/src/shared/customerResource.js",
        "--operations",
        "list"
      ]
    });

    assert.equal(result.status, 1);
    assert.match(
      String(result.stderr || ""),
      /crud-ui-generator crud will not overwrite existing target root src\/pages\/admin\/products\. Re-run with --force to overwrite it\./
    );
    assert.equal(await readFile(lockPath, "utf8"), lockBefore);

    const listPageSource = await readFile(path.join(appRoot, "src/pages/admin/products/index.vue"), "utf8");
    assert.match(listPageSource, /custom products page/);
  });
});

test("generate @jskit-ai/crud-ui-generator allows an empty existing target root without --force", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-empty-target-root");
    await createMinimalApp(appRoot, { name: "crud-ui-empty-target-root" });
    await writeCustomerResource(appRoot);
    await installCrudUiGeneratorPackage(appRoot);
    await mkdir(path.join(appRoot, "src/pages/admin/products"), { recursive: true });

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/crud-ui-generator",
        "crud",
        "admin/products",
        "--resource-file",
        "packages/customers/src/shared/customerResource.js",
        "--operations",
        "list"
      ]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));

    const listPageSource = await readFile(path.join(appRoot, "src/pages/admin/products/index.vue"), "utf8");
    assert.match(listPageSource, /Manage Customers\./);
  });
});

test("generate @jskit-ai/crud-ui-generator overwrites existing generated files when --force is passed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-force-overwrite");
    await createMinimalApp(appRoot, { name: "crud-ui-force-overwrite" });
    await writeCustomerResource(appRoot);
    await mkdir(path.join(appRoot, "src/pages/admin/products"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src/pages/admin/products/index.vue"),
      `<template>
  <div>custom products page</div>
</template>
`,
      "utf8"
    );

    await generateCrudUiPackage(appRoot, {
      targetRoot: "admin/products",
      operations: "list",
      force: true
    });

    const listPageSource = await readFile(path.join(appRoot, "src/pages/admin/products/index.vue"), "utf8");
    assert.match(listPageSource, /Manage Customers\./);
    assert.doesNotMatch(listPageSource, /custom products page/);
  });
});

test("generate @jskit-ai/crud-ui-generator accepts route roots with a src/pages prefix", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-invalid-target-root");
    await createMinimalApp(appRoot, { name: "crud-ui-invalid-target-root" });
    await writeCustomerResource(appRoot);
    await installCrudUiGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/crud-ui-generator",
        "crud",
        "src/pages/admin/products",
        "--resource-file",
        "packages/customers/src/shared/customerResource.js",
        "--operations",
        "list"
      ]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const listPageSource = await readFile(path.join(appRoot, "src/pages/admin/products/index.vue"), "utf8");
    assert.match(listPageSource, /Manage Customers\./);
  });
});

test("add package rejects generator package ids", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-add-rejects-generator");
    await createMinimalApp(appRoot, { name: "crud-ui-add-rejects-generator" });
    await installCrudUiGeneratorPackage(appRoot);

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@jskit-ai/crud-ui-generator"]
    });

    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /is a generator/);
    assert.match(String(addResult.stderr || ""), /jskit generate @jskit-ai\/crud-ui-generator/);
  });
});

test("generate rejects runtime package ids", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "crud-ui-generate-rejects-runtime");
    await createMinimalApp(appRoot, { name: "crud-ui-generate-rejects-runtime" });

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "@jskit-ai/auth-core"]
    });

    assert.equal(result.status, 1);
    assert.match(String(result.stderr || ""), /is a runtime package/);
    assert.match(String(result.stderr || ""), /jskit add package @jskit-ai\/auth-core/);
  });
});
