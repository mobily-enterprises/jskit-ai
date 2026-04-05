import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testSupportDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testSupportDirectory, "..");
const serverTemplateRoot = path.join(packageRoot, "templates", "src", "local-package", "server");

const CRUD_NAMESPACE = Object.freeze({
  snake: "customers",
  camel: "customers",
  singularCamel: "customer",
  pascal: "Customers"
});

const TEMPLATE_REPLACEMENTS = Object.freeze([
  ["${option:namespace|snake}", CRUD_NAMESPACE.snake],
  ["${option:namespace|camel}", CRUD_NAMESPACE.camel],
  ["${option:namespace|singular|camel}", CRUD_NAMESPACE.singularCamel],
  ["${option:namespace|pascal}", CRUD_NAMESPACE.pascal],
  ["__JSKIT_CRUD_ID_COLUMN__", JSON.stringify("id")],
  [
    "__JSKIT_CRUD_LIST_CONFIG_LINES__",
    [
      "  // defaultLimit: 20,",
      "  // maxLimit: 100,",
      "  // searchColumns: [\"name\"],"
    ].join("\n")
  ]
]);

function applyTemplateReplacements(sourceText = "") {
  let rendered = String(sourceText || "");
  for (const [needle, replacement] of TEMPLATE_REPLACEMENTS) {
    rendered = rendered.split(needle).join(replacement);
  }
  return rendered;
}

function buildResourceStubSource() {
  return `const recordOutputValidator = Object.freeze({
  schema: {
    properties: {
      id: {},
      name: {}
    }
  },
  normalize(payload = {}) {
    return payload;
  }
});

const createBodyValidator = Object.freeze({
  schema: {
    properties: {
      name: {},
      contactId: {}
    }
  },
  normalize(payload = {}) {
    return payload;
  }
});

const patchBodyValidator = Object.freeze({
  schema: {
    properties: {
      name: {},
      contactId: {}
    }
  },
  normalize: createBodyValidator.normalize
});

const resource = Object.freeze({
  resource: "customers",
  tableName: "customers",
  idColumn: "id",
  operations: {
    list: {
      outputValidator: Object.freeze({
        schema: {
          properties: {
            items: {},
            nextCursor: {}
          }
        },
        normalize(payload = {}) {
          return payload;
        }
      })
    },
    view: {
      outputValidator: recordOutputValidator
    },
    create: {
      bodyValidator: createBodyValidator,
      outputValidator: recordOutputValidator
    },
    patch: {
      bodyValidator: patchBodyValidator,
      outputValidator: recordOutputValidator
    },
    delete: {
      outputValidator: Object.freeze({
        schema: {
          properties: {
            id: {},
            deleted: {}
          }
        },
        normalize(payload = {}) {
          return payload;
        }
      })
    }
  },
  fieldMeta: [
    {
      key: "contactId",
      relation: {
        kind: "lookup",
        namespace: "contacts",
        valueKey: "id"
      }
    }
  ]
});

export { resource };
`;
}

async function renderServerTemplateFile(targetServerDirectory, fileName) {
  const templatePath = path.join(serverTemplateRoot, fileName);
  const templateSource = await readFile(templatePath, "utf8");
  const renderedSource = applyTemplateReplacements(templateSource);
  await writeFile(path.join(targetServerDirectory, fileName), renderedSource, "utf8");
}

async function createTemplateServerFixture() {
  const fixtureRoot = await mkdtemp(path.join(packageRoot, ".tmp-crud-server-template-fixture-"));
  const srcRoot = path.join(fixtureRoot, "src");
  const serverRoot = path.join(srcRoot, "server");
  const sharedRoot = path.join(srcRoot, "shared");

  await mkdir(serverRoot, { recursive: true });
  await mkdir(sharedRoot, { recursive: true });
  await writeFile(
    path.join(fixtureRoot, "package.json"),
    JSON.stringify({ name: "crud-server-template-fixture", private: true, type: "module" }, null, 2),
    "utf8"
  );
  await writeFile(path.join(sharedRoot, "customerResource.js"), buildResourceStubSource(), "utf8");

  for (const fileName of ["actionIds.js", "actions.js", "listConfig.js", "registerRoutes.js", "repository.js", "service.js"]) {
    await renderServerTemplateFile(serverRoot, fileName);
  }

  async function importServerModule(fileName) {
    const absolutePath = path.join(serverRoot, fileName);
    const href = pathToFileURL(absolutePath).href;
    return import(`${href}?t=${Date.now()}_${Math.random()}`);
  }

  async function cleanup() {
    await rm(fixtureRoot, { recursive: true, force: true });
  }

  return Object.freeze({
    fixtureRoot,
    importServerModule,
    cleanup
  });
}

export { createTemplateServerFixture };
