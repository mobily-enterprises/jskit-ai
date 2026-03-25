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
      enabled: true
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
    email: { type: "string" }
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
    uiSupportPath: path.join(generatedRoot, "uiSupport.js"),
    listElementPath: path.join(generatedRoot, "ListCustomersElement.vue"),
    viewElementPath: path.join(generatedRoot, "ViewCustomerElement.vue"),
    listPagePath: path.join(generatedRoot, "index.vue"),
    viewPagePath: path.join(generatedRoot, "[customerId]", "index.vue")
  };
}

async function addUiGeneratorPackage(appRoot, { operations = "list,view" } = {}) {
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
      operations,
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
  assert.equal(addResult.status, 0, String(addResult.stderr || ""));
}

test("add package @jskit-ai/ui-generator with operations=list,view scaffolds both list and view", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-both");
    await createMinimalApp(appRoot, { name: "ui-generator-app-both" });
    await writeCustomerResource(appRoot);
    await addUiGeneratorPackage(appRoot, { operations: "list,view" });

    const {
      uiSupportPath,
      listElementPath,
      viewElementPath,
      listPagePath,
      viewPagePath
    } = resolveGeneratedPaths(appRoot);

    const uiSupportSource = await readFile(uiSupportPath, "utf8");
    assert.match(uiSupportSource, /const UI_GENERATOR_API_PATH = "\/crud\/customers";/);
    assert.match(uiSupportSource, /const UI_GENERATOR_ROUTE_PATH = "ops\/customers-ui";/);

    const listElementSource = await readFile(listElementPath, "utf8");
    assert.match(listElementSource, /<th>First Name<\/th>/);
    assert.match(listElementSource, /<th>Email<\/th>/);
    assert.doesNotMatch(listElementSource, /__JSKIT_UI_LIST_HEADER_COLUMNS__/);

    const viewElementSource = await readFile(viewElementPath, "utf8");
    assert.match(viewElementSource, /Generated detail view for customer\./);
    assert.match(viewElementSource, /record\.id/);
    assert.doesNotMatch(viewElementSource, /__JSKIT_UI_VIEW_COLUMNS__/);
    assert.match(viewElementSource, /const hasListRoute = true;/);

    const listPageSource = await readFile(listPagePath, "utf8");
    assert.match(listPageSource, /ListCustomersElement/);

    const viewPageSource = await readFile(viewPagePath, "utf8");
    assert.match(viewPageSource, /ViewCustomerElement/);

    assert.equal(await fileExists(path.join(appRoot, "packages", "customers-ui", "package.json")), false);
    assert.equal(await fileExists(path.join(appRoot, "packages", "customers-ui", "package.descriptor.mjs")), false);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /jskit:ui-generator\.menu:customers::ops\/customers-ui/);
    assert.match(placementSource, /users\.web\.shell\.surface-aware-menu-link-item/);
  });
});

test("add package @jskit-ai/ui-generator with operations=list scaffolds list only", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-list");
    await createMinimalApp(appRoot, { name: "ui-generator-app-list" });
    await writeCustomerResource(appRoot);
    await addUiGeneratorPackage(appRoot, { operations: "list" });

    const {
      uiSupportPath,
      listElementPath,
      viewElementPath,
      listPagePath,
      viewPagePath
    } = resolveGeneratedPaths(appRoot);

    assert.equal(await fileExists(uiSupportPath), true);
    assert.equal(await fileExists(listElementPath), true);
    assert.equal(await fileExists(viewElementPath), false);
    assert.equal(await fileExists(listPagePath), true);
    assert.equal(await fileExists(viewPagePath), false);

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

    const {
      uiSupportPath,
      listElementPath,
      viewElementPath,
      listPagePath,
      viewPagePath
    } = resolveGeneratedPaths(appRoot);

    const viewElementSource = await readFile(viewElementPath, "utf8");
    assert.match(viewElementSource, /const hasListRoute = false;/);

    assert.equal(await fileExists(uiSupportPath), true);
    assert.equal(await fileExists(listElementPath), false);
    assert.equal(await fileExists(viewElementPath), true);
    assert.equal(await fileExists(listPagePath), false);
    assert.equal(await fileExists(viewPagePath), true);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.doesNotMatch(placementSource, /jskit:ui-generator\.menu:customers::ops\/customers-ui/);
  });
});

test("add package @jskit-ai/ui-generator fails for unsupported operations value", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "ui-generator-app-invalid-operations");
    await createMinimalApp(appRoot, { name: "ui-generator-app-invalid-operations" });
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
        "create",
        "--resource-file",
        "packages/customers/src/shared/customerResource.js",
        "--resource-export",
        "customerResource",
        "--api-path",
        "/crud/customers",
        "--route-path",
        "ops/customers-ui",
        "--no-install"
      ]
    });
    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /supports only: list, view/);
  });
});
