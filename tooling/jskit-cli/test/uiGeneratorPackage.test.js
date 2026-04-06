import assert from "node:assert/strict";
import { access, constants as fsConstants, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CRUD_UI_GENERATOR_SOURCE_ROOT = path.join(REPO_ROOT, "packages", "crud-ui-generator");
const CRUD_CORE_SOURCE_ROOT = path.join(REPO_ROOT, "packages", "crud-core");
const KERNEL_SOURCE_ROOT = path.join(REPO_ROOT, "packages", "kernel");
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot, { name = "tmp-app" } = {}) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await mkdir(path.join(appRoot, "src"), { recursive: true });
  await mkdir(path.join(appRoot, "src", "components"), { recursive: true });
  await mkdir(path.join(appRoot, "src", "pages", "admin"), { recursive: true });
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
    <ShellOutlet host="shell-layout" position="top-left" />
    <ShellOutlet host="shell-layout" position="top-right" />
    <ShellOutlet host="shell-layout" position="primary-menu" default />
    <ShellOutlet host="shell-layout" position="secondary-menu" />
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

async function writeCustomerResource(appRoot) {
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
  operations: {
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

function resolveGeneratedPaths(appRoot) {
  const generatedRoot = path.join(appRoot, "src", "pages", "admin", "ops", "customers-ui");
  return {
    generatedRoot,
    listPagePath: path.join(generatedRoot, "index.vue"),
    viewPagePath: path.join(generatedRoot, "[customerId]", "index.vue"),
    newPagePath: path.join(generatedRoot, "new.vue"),
    editPagePath: path.join(generatedRoot, "[customerId]", "edit.vue"),
    addEditFormPath: path.join(generatedRoot, "_components", "CustomerAddEditForm.vue"),
    addEditFormFieldsPath: path.join(generatedRoot, "_components", "CustomerAddEditFormFields.js"),
    listElementPath: path.join(generatedRoot, "ListCustomersElement.vue"),
    viewElementPath: path.join(generatedRoot, "ViewCustomerElement.vue"),
    newElementPath: path.join(generatedRoot, "NewCustomerElement.vue"),
    editElementPath: path.join(generatedRoot, "EditCustomerElement.vue")
  };
}

async function generateCrudUiPackage(
  appRoot,
  {
    operations = "list,view",
    displayFields = "",
    namespace = "customers",
    apiPath = "/crud/customers",
    routePath = "ops/customers-ui",
    idParam = "customerId",
    placement = "",
    placementComponentToken = "",
    placementTo = "",
    directoryPrefix = "",
    command = ""
  } = {}
) {
  await installCrudUiGeneratorPackage(appRoot);
  const normalizedDisplayFields = String(displayFields || "").trim();
  const args = [
    "generate",
    "@jskit-ai/crud-ui-generator",
    ...(command ? [command] : []),
    "--namespace",
    namespace,
    "--surface",
    "admin",
    "--operations",
    operations,
    ...(normalizedDisplayFields ? ["--display-fields", normalizedDisplayFields] : []),
    "--resource-file",
    "packages/customers/src/shared/customerResource.js",
    "--api-path",
    apiPath,
    "--route-path",
    routePath,
    ...(String(directoryPrefix || "").trim() ? ["--directory-prefix", String(directoryPrefix || "").trim()] : []),
    ...(String(placement || "").trim() ? ["--placement", String(placement || "").trim()] : []),
    ...(String(placementComponentToken || "").trim()
      ? ["--placement-component-token", String(placementComponentToken || "").trim()]
      : []),
    ...(String(placementTo || "").trim() ? ["--placement-to", String(placementTo || "").trim()] : []),
    "--id-param",
    idParam
  ];

  const addResult = runCli({
    cwd: appRoot,
    args
  });
  assert.equal(addResult.status, 0, String(addResult.stderr || ""));
}

test('generate @jskit-ai/crud-ui-generator loads named export "resource" from resource-file', async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-default-export");
    await createMinimalApp(appRoot, { name: "ui-generator-app-default-export" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, {
      operations: "list,view"
    });

    const paths = resolveGeneratedPaths(appRoot);
    assert.equal(await fileExists(paths.listPagePath), true);
    assert.equal(await fileExists(paths.viewPagePath), true);
  });
});

test("generate @jskit-ai/crud-ui-generator derives api-path and route-path from namespace when omitted", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-derived-paths");
    await createMinimalApp(appRoot, { name: "ui-generator-app-derived-paths" });
    await writeCustomerResource(appRoot);
    await installCrudUiGeneratorPackage(appRoot);

    const addResult = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/crud-ui-generator",
        "--namespace",
        "contacts",
        "--surface",
        "admin",
        "--operations",
        "list,view,new,edit",
        "--resource-file",
        "packages/customers/src/shared/customerResource.js",
        "--id-param",
        "recordId"
      ]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const listPagePath = path.join(appRoot, "src", "pages", "admin", "contacts", "index.vue");
    assert.equal(await fileExists(listPagePath), true);
    const listPageSource = await readFile(listPagePath, "utf8");
    assert.match(listPageSource, /const UI_LIST_API_URL = "\/contacts";/);
  });
});

test("generate @jskit-ai/crud-ui-generator crud runs canonical noun command", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-crud-command");
    await createMinimalApp(appRoot, { name: "ui-generator-app-crud-command" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, {
      operations: "list,view",
      command: "crud"
    });

    const paths = resolveGeneratedPaths(appRoot);
    assert.equal(await fileExists(paths.listPagePath), true);
    assert.equal(await fileExists(paths.viewPagePath), true);
  });
});

test("generate @jskit-ai/crud-ui-generator with list,view,new,edit scaffolds all client files", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-all");
    await createMinimalApp(appRoot, { name: "ui-generator-app-all" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, { operations: "list,view,new,edit" });

    const paths = resolveGeneratedPaths(appRoot);
    assert.equal(await fileExists(paths.listPagePath), true, paths.listPagePath);
    assert.equal(await fileExists(paths.viewPagePath), true, paths.viewPagePath);
    assert.equal(await fileExists(paths.newPagePath), true, paths.newPagePath);
    assert.equal(await fileExists(paths.editPagePath), true, paths.editPagePath);
    assert.equal(await fileExists(paths.addEditFormPath), true, paths.addEditFormPath);
    assert.equal(await fileExists(paths.addEditFormFieldsPath), true, paths.addEditFormFieldsPath);
    assert.equal(await fileExists(paths.listElementPath), false, paths.listElementPath);
    assert.equal(await fileExists(paths.viewElementPath), false, paths.viewElementPath);
    assert.equal(await fileExists(paths.newElementPath), false, paths.newElementPath);
    assert.equal(await fileExists(paths.editElementPath), false, paths.editElementPath);

    const listPageSource = await readFile(paths.listPagePath, "utf8");
    assert.match(listPageSource, /<th>First Name<\/th>/);
    assert.match(listPageSource, /<th>Email<\/th>/);
    assert.match(listPageSource, /const UI_VIEW_URL = true \? `\.\/:\$\{UI_RECORD_ID_PARAM\}` : "";/);
    assert.match(listPageSource, /const UI_EDIT_URL = true \? `\.\/:\$\{UI_RECORD_ID_PARAM\}\/edit` : "";/);
    assert.match(listPageSource, /const UI_NEW_URL = true \? "\.\/new" : "";/);
    assert.doesNotMatch(listPageSource, /const UI_HAS_[A-Z_]+_ROUTE =/);
    assert.match(listPageSource, /const UI_OPERATION_ADAPTER = null;/);
    assert.match(listPageSource, /queryKeyFactory: \(surfaceId = "", workspaceSlug = ""\)/);
    assert.match(listPageSource, /v-if="records\.searchEnabled"/);
    assert.match(listPageSource, /v-model="records\.searchQuery"/);
    assert.match(listPageSource, /:loading="records\.isSearchDebouncing"/);
    assert.match(listPageSource, /search:\s*\{\s*enabled:\s*true,\s*mode:\s*"query"\s*\}/);
    assert.match(listPageSource, /recordIdSelector: \(item = \{\}\) => item\.id,/);
    assert.match(listPageSource, /viewUrlTemplate: UI_VIEW_URL,/);
    assert.match(listPageSource, /editUrlTemplate: UI_EDIT_URL,/);
    assert.doesNotMatch(listPageSource, /useListCore/);
    assert.doesNotMatch(listPageSource, /clientSupport/);
    assert.doesNotMatch(listPageSource, /function resolveTemplateUrl/);
    assert.doesNotMatch(listPageSource, /function toRouteRecordId/);

    const viewPageSource = await readFile(paths.viewPagePath, "utf8");
    assert.match(viewPageSource, /View and manage this customer\./);
    assert.match(viewPageSource, /const UI_API_BASE_URL = "\/crud\/customers";/);
    assert.match(viewPageSource, /const UI_VIEW_API_URL = `\$\{UI_API_BASE_URL\}\/:\$\{UI_RECORD_ID_PARAM\}`;/);
    assert.match(viewPageSource, /apiUrlTemplate: UI_VIEW_API_URL,/);
    assert.match(viewPageSource, /recordIdParam: UI_RECORD_ID_PARAM,/);
    assert.match(viewPageSource, /includeRecordIdInQueryKey: true,/);
    assert.match(viewPageSource, /view\.record\?\.firstName/);
    assert.doesNotMatch(viewPageSource, /function resolveTemplateUrl/);
    assert.doesNotMatch(viewPageSource, /function toRouteRecordId/);
    assert.doesNotMatch(viewPageSource, /useRoute/);
    assert.doesNotMatch(viewPageSource, /const record = computed/);
    assert.match(viewPageSource, /view\.resolveRecordTitle\(view\.record,\s*\{/);
    assert.match(viewPageSource, /fallbackKey:\s*UI_VIEW_TITLE_FALLBACK_FIELD_KEY,/);
    assert.match(viewPageSource, /defaultValue:\s*"Customer"/);

    const newPageSource = await readFile(paths.newPagePath, "utf8");
    assert.match(newPageSource, /useCrudAddEdit/);
    assert.match(newPageSource, /const formRuntime = useCrudAddEdit\(/);
    assert.match(newPageSource, /writeMethod: "POST"/);
    assert.match(newPageSource, /recordIdParam: UI_RECORD_ID_PARAM,/);
    assert.match(newPageSource, /viewUrlTemplate: UI_VIEW_URL,/);
    assert.match(newPageSource, /listUrlTemplate: UI_LIST_URL,/);
    assert.match(newPageSource, /const UI_CANCEL_URL = UI_LIST_URL;/);
    assert.match(newPageSource, /CustomerAddEditForm/);
    assert.match(newPageSource, /UI_CREATE_FORM_FIELDS/);
    assert.match(newPageSource, /jskit:crud-ui-fields-target \.\/_components\/CustomerAddEditForm\.vue/);
    assert.match(newPageSource, /jskit:crud-ui-form-fields-target \.\/_components\/CustomerAddEditFormFields\.js/);
    assert.doesNotMatch(newPageSource, /v-model="formRuntime\.form\.firstName"/);
    assert.doesNotMatch(newPageSource, /function resolveTemplateUrl/);
    assert.doesNotMatch(newPageSource, /function toRouteRecordId/);
    assert.match(newPageSource, /from "\/packages\/customers\/src\/shared\/customerResource\.js";/);

    const editPageSource = await readFile(paths.editPagePath, "utf8");
    assert.match(editPageSource, /useCrudAddEdit/);
    assert.match(editPageSource, /const formRuntime = useCrudAddEdit\(/);
    assert.match(editPageSource, /writeMethod: "PATCH"/);
    assert.match(editPageSource, /apiUrlTemplate: UI_EDIT_API_URL,/);
    assert.match(editPageSource, /recordIdParam: UI_RECORD_ID_PARAM,/);
    assert.match(editPageSource, /routeRecordId,/);
    assert.match(editPageSource, /viewUrlTemplate: UI_VIEW_URL,/);
    assert.match(editPageSource, /listUrlTemplate: UI_LIST_URL,/);
    assert.match(editPageSource, /CustomerAddEditForm/);
    assert.match(editPageSource, /UI_EDIT_FORM_FIELDS/);
    assert.match(editPageSource, /if \(!resolvedPath\) \{\s*return "";\s*\}/);
    assert.match(editPageSource, /jskit:crud-ui-fields-target \.\.\/_components\/CustomerAddEditForm\.vue/);
    assert.match(editPageSource, /jskit:crud-ui-form-fields-target \.\.\/_components\/CustomerAddEditFormFields\.js/);
    assert.doesNotMatch(editPageSource, /v-model="formRuntime\.form\.email"/);
    assert.doesNotMatch(editPageSource, /function resolveTemplateUrl/);
    assert.doesNotMatch(editPageSource, /function toRouteRecordId/);
    assert.match(editPageSource, /from "\/packages\/customers\/src\/shared\/customerResource\.js";/);

    const addEditFormSource = await readFile(paths.addEditFormPath, "utf8");
    assert.match(addEditFormSource, /<template v-if="mode === 'new'">/);
    assert.match(addEditFormSource, /<!-- jskit:crud-ui-fields:new -->/);
    assert.match(addEditFormSource, /<!-- jskit:crud-ui-fields:edit -->/);
    assert.match(addEditFormSource, /v-model="formRuntime\.form\.firstName"/);
    assert.match(addEditFormSource, /v-model="formRuntime\.form\.email"/);

    const addEditFormFieldsSource = await readFile(paths.addEditFormFieldsPath, "utf8");
    assert.match(addEditFormFieldsSource, /const UI_CREATE_FORM_FIELDS = \[];/);
    assert.match(addEditFormFieldsSource, /const UI_EDIT_FORM_FIELDS = \[];/);
    assert.match(addEditFormFieldsSource, /jskit:crud-ui-form-fields:new/);
    assert.match(addEditFormFieldsSource, /jskit:crud-ui-form-fields:edit/);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /jskit:ui-generator\.menu:customers:::ops\/customers-ui/);
  });
});

test("generate @jskit-ai/crud-ui-generator with operations=new,edit omits invalid cancel targets", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-new-edit-only");
    await createMinimalApp(appRoot, { name: "ui-generator-app-new-edit-only" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, { operations: "new,edit" });

    const paths = resolveGeneratedPaths(appRoot);
    assert.equal(await fileExists(paths.listPagePath), false);
    assert.equal(await fileExists(paths.viewPagePath), false);

    const newPageSource = await readFile(paths.newPagePath, "utf8");
    assert.match(newPageSource, /const UI_LIST_URL = false \? "\.\." : "";/);
    assert.match(newPageSource, /const UI_VIEW_URL = false \? `\.\.\/:\$\{UI_RECORD_ID_PARAM\}` : "";/);
    assert.match(newPageSource, /const UI_CANCEL_URL = UI_LIST_URL;/);

    const editPageSource = await readFile(paths.editPagePath, "utf8");
    assert.match(editPageSource, /const UI_LIST_URL = false \? "\.\.\/\.\." : "";/);
    assert.match(editPageSource, /const UI_VIEW_URL = false \? "\.\." : "";/);
    assert.match(editPageSource, /const UI_CANCEL_URL = UI_VIEW_URL \|\| UI_LIST_URL;/);
    assert.match(editPageSource, /if \(!resolvedPath\) \{\s*return "";\s*\}/);
  });
});

test("generate @jskit-ai/crud-ui-generator uses --placement when provided", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-placement-override");
    await createMinimalApp(appRoot, { name: "ui-generator-app-placement-override" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, {
      operations: "list",
      placement: "shell-layout:secondary-menu"
    });

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /position: "secondary-menu"/);
  });
});

test("generate @jskit-ai/crud-ui-generator with operations=list scaffolds list only", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-list");
    await createMinimalApp(appRoot, { name: "ui-generator-app-list" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, { operations: "list" });

    const paths = resolveGeneratedPaths(appRoot);
    assert.equal(await fileExists(paths.listPagePath), true);
    assert.equal(await fileExists(paths.listElementPath), false);
    assert.equal(await fileExists(paths.viewElementPath), false);
    assert.equal(await fileExists(paths.newElementPath), false);
    assert.equal(await fileExists(paths.editElementPath), false);
    assert.equal(await fileExists(paths.viewPagePath), false);
    assert.equal(await fileExists(paths.newPagePath), false);
    assert.equal(await fileExists(paths.editPagePath), false);

    const listPageSource = await readFile(paths.listPagePath, "utf8");
    assert.match(listPageSource, /const UI_VIEW_URL = false \? `\.\/:\$\{UI_RECORD_ID_PARAM\}` : "";/);
    assert.match(listPageSource, /const UI_EDIT_URL = false \? `\.\/:\$\{UI_RECORD_ID_PARAM\}\/edit` : "";/);
    assert.match(listPageSource, /const UI_NEW_URL = false \? "\.\/new" : "";/);
    assert.doesNotMatch(listPageSource, /const UI_HAS_[A-Z_]+_ROUTE =/);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /jskit:ui-generator\.menu:customers:::ops\/customers-ui/);
  });
});

test("generate @jskit-ai/crud-ui-generator does not append menu placement for dynamic route paths", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-dynamic-route-no-menu");
    await createMinimalApp(appRoot, { name: "ui-generator-app-dynamic-route-no-menu" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, {
      namespace: "addresses",
      apiPath: "/addresses",
      operations: "list,view,new,edit",
      routePath: "contacts/[contactId]/addresses",
      idParam: "addressId"
    });

    const dynamicListPagePath = path.join(
      appRoot,
      "src",
      "pages",
      "admin",
      "contacts",
      "[contactId]",
      "addresses",
      "index.vue"
    );
    assert.equal(await fileExists(dynamicListPagePath), true);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.doesNotMatch(placementSource, /jskit:ui-generator\.menu:addresses:::contacts\/\[contactId\]\/addresses/);
    assert.doesNotMatch(placementSource, /workspaceSuffix:\s*"\/contacts\/\[contactId\]\/addresses"/);
  });
});

test("generate @jskit-ai/crud-ui-generator does not append menu placement for dynamic directory-prefix", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-dynamic-prefix-no-menu");
    await createMinimalApp(appRoot, { name: "ui-generator-app-dynamic-prefix-no-menu" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, {
      namespace: "pets",
      apiPath: "/pets",
      operations: "list,view,new,edit",
      directoryPrefix: "contacts/[contactId]/(nestedChildren)",
      routePath: "pets",
      idParam: "petId"
    });

    const dynamicListPagePath = path.join(
      appRoot,
      "src",
      "pages",
      "admin",
      "contacts",
      "[contactId]",
      "(nested-children)",
      "pets",
      "index.vue"
    );
    assert.equal(await fileExists(dynamicListPagePath), true);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.doesNotMatch(placementSource, /jskit:ui-generator\.menu:pets:contacts\/\[contactId\]\/\(nested-children\)::pets/);
    assert.doesNotMatch(placementSource, /workspaceSuffix:\s*"\/contacts\/\[contactId\]\/pets"/);
  });
});

test("generate @jskit-ai/crud-ui-generator appends placement for dynamic directory-prefix when explicit placement and placement-to are provided", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-dynamic-prefix-placement");
    await createMinimalApp(appRoot, { name: "ui-generator-app-dynamic-prefix-placement" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, {
      namespace: "pets",
      apiPath: "/pets",
      operations: "list,view,new,edit",
      directoryPrefix: "contacts/[contactId]/(nestedChildren)",
      routePath: "pets",
      idParam: "petId",
      placement: "shell-layout:secondary-menu",
      placementComponentToken: "local.main.ui.tab-link-item",
      placementTo: "./pets"
    });

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /jskit:ui-generator\.menu:pets:contacts\/\[contactId\]\/\(nested-children\)::pets/);
    assert.match(placementSource, /host: "shell-layout"/);
    assert.match(placementSource, /position: "secondary-menu"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.tab-link-item"/);
    assert.match(placementSource, /to: "\.\/pets"/);

    const tabLinkComponentPath = path.join(appRoot, "src", "components", "TabLinkItem.vue");
    assert.equal(await fileExists(tabLinkComponentPath), true);
    const tabLinkSource = await readFile(tabLinkComponentPath, "utf8");
    assert.equal(tabLinkSource.includes("source.replace(/\\[([^\\]]+)\\]/g"), true);
    assert.equal(tabLinkSource.includes("source.replace(/[([^]]+)]/g"), false);

    const providerSource = await readFile(
      path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js"),
      "utf8"
    );
    assert.match(providerSource, /import TabLinkItem from "\/src\/components\/TabLinkItem\.vue";/);
    assert.match(providerSource, /registerMainClientComponent\("local\.main\.ui\.tab-link-item", \(\) => TabLinkItem\);/);
  });
});

test("generate @jskit-ai/crud-ui-generator does not duplicate existing local.main.ui.tab-link-item registrations", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-existing-tab-link-token");
    await createMinimalApp(appRoot, { name: "ui-generator-app-existing-tab-link-token" });
    await writeCustomerResource(appRoot);

    await writeFile(
      path.join(appRoot, "src", "components", "ExistingTabLinkItem.vue"),
      "<template><div /></template>\n",
      "utf8"
    );

    await writeFile(
      path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js"),
      `import ExistingTabLinkItem from "/src/components/ExistingTabLinkItem.vue";

const mainClientComponents = [];

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

registerMainClientComponent("local.main.ui.tab-link-item", () => ExistingTabLinkItem);

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

    await generateCrudUiPackage(appRoot, {
      namespace: "pets",
      apiPath: "/pets",
      operations: "list,view,new,edit",
      directoryPrefix: "contacts/[contactId]/(nestedChildren)",
      routePath: "pets",
      idParam: "petId",
      placement: "shell-layout:secondary-menu",
      placementComponentToken: "local.main.ui.tab-link-item",
      placementTo: "./pets"
    });

    const providerSource = await readFile(
      path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js"),
      "utf8"
    );
    assert.match(providerSource, /registerMainClientComponent\("local\.main\.ui\.tab-link-item", \(\) => ExistingTabLinkItem\);/);
    assert.doesNotMatch(providerSource, /import TabLinkItem from "\/src\/components\/TabLinkItem\.vue";/);
    assert.doesNotMatch(providerSource, /registerMainClientComponent\("local\.main\.ui\.tab-link-item", \(\) => TabLinkItem\);/);

    const tabLinkComponentPath = path.join(appRoot, "src", "components", "TabLinkItem.vue");
    assert.equal(await fileExists(tabLinkComponentPath), false);
  });
});

test("generate @jskit-ai/crud-ui-generator with operations=view scaffolds view only", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-view");
    await createMinimalApp(appRoot, { name: "ui-generator-app-view" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, { operations: "view" });

    const paths = resolveGeneratedPaths(appRoot);
    assert.equal(await fileExists(paths.viewPagePath), true);
    assert.equal(await fileExists(paths.viewElementPath), false);
    assert.equal(await fileExists(paths.listElementPath), false);
    assert.equal(await fileExists(paths.listPagePath), false);
    assert.equal(await fileExists(paths.newElementPath), false);
    assert.equal(await fileExists(paths.editElementPath), false);

    const viewPageSource = await readFile(paths.viewPagePath, "utf8");
    assert.match(viewPageSource, /const UI_LIST_URL = false \? "\.\." : "";/);
    assert.match(viewPageSource, /const UI_EDIT_URL = false \? "\.\/edit" : "";/);
    assert.doesNotMatch(viewPageSource, /const UI_HAS_[A-Z_]+_ROUTE =/);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.doesNotMatch(placementSource, /jskit:ui-generator\.menu:customers:::ops\/customers-ui/);
  });
});

test("generate @jskit-ai/crud-ui-generator applies display-fields filter to list/view/forms", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-display-fields");
    await createMinimalApp(appRoot, { name: "ui-generator-app-display-fields" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, {
      operations: "list,view,new,edit",
      displayFields: "firstName,email"
    });

    const paths = resolveGeneratedPaths(appRoot);
    const listPageSource = await readFile(paths.listPagePath, "utf8");
    assert.match(listPageSource, /<th>First Name<\/th>/);
    assert.match(listPageSource, /<th>Email<\/th>/);
    assert.doesNotMatch(listPageSource, /<th>Vip<\/th>/);

    const viewPageSource = await readFile(paths.viewPagePath, "utf8");
    assert.match(viewPageSource, /view\.record\?\.firstName/);
    assert.match(viewPageSource, /view\.record\?\.email/);
    assert.doesNotMatch(viewPageSource, /view\.record\?\.vip/);

    const newPageSource = await readFile(paths.newPagePath, "utf8");
    assert.match(newPageSource, /CustomerAddEditForm/);
    assert.doesNotMatch(newPageSource, /v-model="formRuntime\.form\.vip"/);

    const addEditFormSource = await readFile(paths.addEditFormPath, "utf8");
    assert.match(addEditFormSource, /v-model="formRuntime\.form\.firstName"/);
    assert.match(addEditFormSource, /v-model="formRuntime\.form\.email"/);
    assert.doesNotMatch(addEditFormSource, /v-model="formRuntime\.form\.vip"/);

    const addEditFormFieldsSource = await readFile(paths.addEditFormFieldsPath, "utf8");
    assert.match(addEditFormFieldsSource, /UI_CREATE_FORM_FIELDS\.push\(\{[\s\S]*"key": "firstName"/);
    assert.match(addEditFormFieldsSource, /UI_CREATE_FORM_FIELDS\.push\(\{[\s\S]*"key": "email"/);
    assert.doesNotMatch(addEditFormFieldsSource, /"key": "vip"/);
  });
});

test("generate @jskit-ai/crud-ui-generator fails when display-fields includes unknown keys", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-invalid-display-fields");
    await createMinimalApp(appRoot, { name: "ui-generator-app-invalid-display-fields" });
    await writeCustomerResource(appRoot);
    await installCrudUiGeneratorPackage(appRoot);

    const addResult = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@jskit-ai/crud-ui-generator",
        "--namespace",
        "customers",
        "--surface",
        "admin",
        "--operations",
        "list,view,new,edit",
        "--display-fields",
        "firstName,unknownField",
        "--resource-file",
        "packages/customers/src/shared/customerResource.js",
        "--api-path",
        "/crud/customers",
        "--route-path",
        "ops/customers-ui",
        "--id-param",
        "customerId"
      ]
    });

    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /display-fields" includes unsupported field\(s\)/);
  });
});

test("generate @jskit-ai/crud-ui-generator supports spaced operation lists in when filters", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-spaced-operations");
    await createMinimalApp(appRoot, { name: "ui-generator-app-spaced-operations" });
    await writeCustomerResource(appRoot);
    await generateCrudUiPackage(appRoot, { operations: "view , list , edit" });

    const paths = resolveGeneratedPaths(appRoot);
    assert.equal(await fileExists(paths.listPagePath), true);
    assert.equal(await fileExists(paths.viewPagePath), true);
    assert.equal(await fileExists(paths.editPagePath), true);
    assert.equal(await fileExists(paths.newPagePath), false);
    assert.equal(await fileExists(paths.listElementPath), false);
    assert.equal(await fileExists(paths.viewElementPath), false);
    assert.equal(await fileExists(paths.editElementPath), false);
    assert.equal(await fileExists(paths.newElementPath), false);
  });
});

test("add package rejects generator package ids", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-add-rejects-generator");
    await createMinimalApp(appRoot, { name: "ui-generator-add-rejects-generator" });
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
    const appRoot = path.join(cwd, "ui-generator-generate-rejects-runtime");
    await createMinimalApp(appRoot, { name: "ui-generator-generate-rejects-runtime" });

    const addResult = runCli({
      cwd: appRoot,
      args: ["generate", "@jskit-ai/auth-core"]
    });

    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /is a runtime package/);
    assert.match(String(addResult.stderr || ""), /jskit add package @jskit-ai\/auth-core/);
  });
});
