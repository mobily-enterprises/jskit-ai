import assert from "node:assert/strict";
import { access, constants as fsConstants, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot, { name = "tmp-app" } = {}) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await mkdir(path.join(appRoot, "src"), { recursive: true });
  await mkdir(path.join(appRoot, "src", "pages", "admin"), { recursive: true });

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

const customerResource = {
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

export { customerResource };
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
    listElementPath: path.join(generatedRoot, "ListCustomersElement.vue"),
    viewElementPath: path.join(generatedRoot, "ViewCustomerElement.vue"),
    newElementPath: path.join(generatedRoot, "NewCustomerElement.vue"),
    editElementPath: path.join(generatedRoot, "EditCustomerElement.vue")
  };
}

async function addUiGeneratorPackage(
  appRoot,
  {
    operations = "list,view",
    displayFields = "",
    namespace = "customers",
    apiPath = "/crud/customers"
  } = {}
) {
  const normalizedDisplayFields = String(displayFields || "").trim();
  const args = [
    "add",
    "package",
    "@jskit-ai/ui-generator",
    "--namespace",
    namespace,
    "--surface",
    "admin",
    "--operations",
    operations,
    ...(normalizedDisplayFields ? ["--display-fields", normalizedDisplayFields] : []),
    "--resource-file",
    "packages/customers/src/shared/customerResource.js",
    "--resource-export",
    "customerResource",
    "--api-path",
    apiPath,
    "--route-path",
    "ops/customers-ui",
    "--id-param",
    "customerId",
    "--no-install"
  ];

  const addResult = runCli({
    cwd: appRoot,
    args
  });
  assert.equal(addResult.status, 0, String(addResult.stderr || ""));
}

test("add package @jskit-ai/ui-generator with list,view,new,edit scaffolds all client files", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-all");
    await createMinimalApp(appRoot, { name: "ui-generator-app-all" });
    await writeCustomerResource(appRoot);
    await addUiGeneratorPackage(appRoot, { operations: "list,view,new,edit" });

    const paths = resolveGeneratedPaths(appRoot);
    assert.equal(await fileExists(paths.listPagePath), true, paths.listPagePath);
    assert.equal(await fileExists(paths.viewPagePath), true, paths.viewPagePath);
    assert.equal(await fileExists(paths.newPagePath), true, paths.newPagePath);
    assert.equal(await fileExists(paths.editPagePath), true, paths.editPagePath);
    assert.equal(await fileExists(paths.listElementPath), false, paths.listElementPath);
    assert.equal(await fileExists(paths.viewElementPath), false, paths.viewElementPath);
    assert.equal(await fileExists(paths.newElementPath), false, paths.newElementPath);
    assert.equal(await fileExists(paths.editElementPath), false, paths.editElementPath);

    const listPageSource = await readFile(paths.listPagePath, "utf8");
    assert.match(listPageSource, /<th>First Name<\/th>/);
    assert.match(listPageSource, /<th>Email<\/th>/);
    assert.match(listPageSource, /const UI_HAS_VIEW_ROUTE = true;/);
    assert.match(listPageSource, /const UI_HAS_EDIT_ROUTE = true;/);
    assert.match(listPageSource, /const UI_HAS_NEW_ROUTE = true;/);
    assert.match(listPageSource, /const UI_VIEW_URL = UI_HAS_VIEW_ROUTE \? `\.\/:\$\{UI_RECORD_ID_PARAM\}` : "";/);
    assert.match(listPageSource, /const UI_EDIT_URL = UI_HAS_EDIT_ROUTE \? `\.\/:\$\{UI_RECORD_ID_PARAM\}\/edit` : "";/);
    assert.match(listPageSource, /const UI_NEW_URL = UI_HAS_NEW_ROUTE \? "\.\/new" : "";/);
    assert.match(listPageSource, /const UI_OPERATION_ADAPTER = null;/);
    assert.match(listPageSource, /queryKeyFactory: \(surfaceId = "", workspaceSlug = ""\)/);
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
    assert.match(viewPageSource, /<v-card-title class="px-0">Customer<\/v-card-title>/);

    const newPageSource = await readFile(paths.newPagePath, "utf8");
    assert.match(newPageSource, /useAddEdit/);
    assert.match(newPageSource, /writeMethod: "POST"/);
    assert.match(newPageSource, /recordIdParam: UI_RECORD_ID_PARAM,/);
    assert.match(newPageSource, /viewUrlTemplate: UI_VIEW_URL,/);
    assert.match(newPageSource, /listUrlTemplate: UI_LIST_URL,/);
    assert.match(newPageSource, /addEdit\.resolveSavedViewUrl\(payload\)/);
    assert.doesNotMatch(newPageSource, /function resolveTemplateUrl/);
    assert.doesNotMatch(newPageSource, /function toRouteRecordId/);
    assert.match(newPageSource, /from "\/packages\/customers\/src\/shared\/customerResource\.js";/);

    const editPageSource = await readFile(paths.editPagePath, "utf8");
    assert.match(editPageSource, /useAddEdit/);
    assert.match(editPageSource, /writeMethod: "PATCH"/);
    assert.match(editPageSource, /apiUrlTemplate: UI_EDIT_API_URL,/);
    assert.match(editPageSource, /recordIdParam: UI_RECORD_ID_PARAM,/);
    assert.match(editPageSource, /routeRecordId,/);
    assert.match(editPageSource, /viewUrlTemplate: UI_VIEW_URL,/);
    assert.match(editPageSource, /listUrlTemplate: UI_LIST_URL,/);
    assert.match(editPageSource, /addEdit\.resolveSavedViewUrl\(payload\)/);
    assert.doesNotMatch(editPageSource, /function resolveTemplateUrl/);
    assert.doesNotMatch(editPageSource, /function toRouteRecordId/);
    assert.match(editPageSource, /from "\/packages\/customers\/src\/shared\/customerResource\.js";/);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /jskit:ui-generator\.menu:customers::ops\/customers-ui/);
  });
});

test("add package @jskit-ai/ui-generator with operations=list scaffolds list only", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-list");
    await createMinimalApp(appRoot, { name: "ui-generator-app-list" });
    await writeCustomerResource(appRoot);
    await addUiGeneratorPackage(appRoot, { operations: "list" });

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
    assert.match(listPageSource, /const UI_HAS_VIEW_ROUTE = false;/);
    assert.match(listPageSource, /const UI_HAS_EDIT_ROUTE = false;/);
    assert.match(listPageSource, /const UI_HAS_NEW_ROUTE = false;/);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /jskit:ui-generator\.menu:customers::ops\/customers-ui/);
  });
});

test("add package @jskit-ai/ui-generator with operations=view scaffolds view only", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-view");
    await createMinimalApp(appRoot, { name: "ui-generator-app-view" });
    await writeCustomerResource(appRoot);
    await addUiGeneratorPackage(appRoot, { operations: "view" });

    const paths = resolveGeneratedPaths(appRoot);
    assert.equal(await fileExists(paths.viewPagePath), true);
    assert.equal(await fileExists(paths.viewElementPath), false);
    assert.equal(await fileExists(paths.listElementPath), false);
    assert.equal(await fileExists(paths.listPagePath), false);
    assert.equal(await fileExists(paths.newElementPath), false);
    assert.equal(await fileExists(paths.editElementPath), false);

    const viewPageSource = await readFile(paths.viewPagePath, "utf8");
    assert.match(viewPageSource, /const UI_HAS_LIST_ROUTE = false;/);
    assert.match(viewPageSource, /const UI_HAS_EDIT_ROUTE = false;/);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.doesNotMatch(placementSource, /jskit:ui-generator\.menu:customers::ops\/customers-ui/);
  });
});

test("add package @jskit-ai/ui-generator applies display-fields filter to list/view/forms", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-display-fields");
    await createMinimalApp(appRoot, { name: "ui-generator-app-display-fields" });
    await writeCustomerResource(appRoot);
    await addUiGeneratorPackage(appRoot, {
      operations: "list,view,new,edit",
      displayFields: "firstName,email"
    });

    const paths = resolveGeneratedPaths(appRoot);
    const listPageSource = await readFile(paths.listPagePath, "utf8");
    assert.match(listPageSource, /<th>First Name<\/th>/);
    assert.match(listPageSource, /<th>Email<\/th>/);
    assert.doesNotMatch(listPageSource, /<th>Vip<\/th>/);

    const viewPageSource = await readFile(paths.viewPagePath, "utf8");
    assert.match(viewPageSource, /record\.firstName/);
    assert.match(viewPageSource, /record\.email/);
    assert.doesNotMatch(viewPageSource, /record\.vip/);

    const newPageSource = await readFile(paths.newPagePath, "utf8");
    assert.match(newPageSource, /\{"key":"firstName"/);
    assert.match(newPageSource, /\{"key":"email"/);
    assert.doesNotMatch(newPageSource, /\{"key":"vip"/);
  });
});

test("add package @jskit-ai/ui-generator fails when display-fields includes unknown keys", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-invalid-display-fields");
    await createMinimalApp(appRoot, { name: "ui-generator-app-invalid-display-fields" });
    await writeCustomerResource(appRoot);

    const addResult = runCli({
      cwd: appRoot,
      args: [
        "add",
        "package",
        "@jskit-ai/ui-generator",
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
        "--resource-export",
        "customerResource",
        "--api-path",
        "/crud/customers",
        "--route-path",
        "ops/customers-ui",
        "--id-param",
        "customerId",
        "--no-install"
      ]
    });

    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /display-fields" includes unsupported field\(s\)/);
  });
});

test("add package @jskit-ai/ui-generator supports spaced operation lists in when filters", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-spaced-operations");
    await createMinimalApp(appRoot, { name: "ui-generator-app-spaced-operations" });
    await writeCustomerResource(appRoot);
    await addUiGeneratorPackage(appRoot, { operations: "view , list , edit" });

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
