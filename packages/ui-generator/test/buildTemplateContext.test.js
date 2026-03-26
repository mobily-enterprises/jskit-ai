import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildUiTemplateContext } from "../src/server/buildTemplateContext.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "ui-generator-app-"));
  try {
    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

async function writeResource(appRoot, relativeFile, source) {
  const absoluteFile = path.join(appRoot, relativeFile);
  await mkdir(path.dirname(absoluteFile), { recursive: true });
  await writeFile(absoluteFile, source, "utf8");
}

const FULL_RESOURCE_SOURCE = `const customerRecordSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    firstName: { type: "string" },
    email: { type: "string" },
    vip: { type: "boolean" },
    updatedAt: { type: "string", format: "date-time" }
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
`;

test("buildUiTemplateContext derives list/view/new/edit placeholders from resource validators", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/customerResource.js";
    await writeResource(appRoot, resourceFile, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        operations: "list,view,new,edit",
        "resource-file": resourceFile,
        "resource-export": "customerResource"
      }
    });

    assert.equal(context.__JSKIT_UI_LIST_DATA_COLUMN_COUNT__, "5");
    assert.match(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /<th>First Name<\/th>/);
    assert.match(context.__JSKIT_UI_LIST_ROW_COLUMNS__, /record\.updatedAt/);
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /record\.vip/);
    assert.equal(context.__JSKIT_UI_LIST_RECORD_ID_EXPR__, "item.id");
    assert.equal(context.__JSKIT_UI_RECORD_CHANGED_EVENT__, "\"customers.record.changed\"");
    assert.equal(context.__JSKIT_UI_HAS_LIST_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_VIEW_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_NEW_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_EDIT_ROUTE__, "true");

    const createFields = JSON.parse(context.__JSKIT_UI_CREATE_FORM_FIELDS__);
    const editFields = JSON.parse(context.__JSKIT_UI_EDIT_FORM_FIELDS__);
    assert.deepEqual(
      createFields.map((field) => field.key),
      ["firstName", "email", "vip"]
    );
    assert.deepEqual(
      editFields.map((field) => field.key),
      ["firstName", "email", "vip"]
    );
    assert.equal(createFields[0].inputType, "text");
    assert.equal(createFields[0].maxLength, 120);
    assert.equal(createFields[2].component, "switch");
  });
});

test("buildUiTemplateContext filters rendered fields when display-fields is provided", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/customerResource.js";
    await writeResource(appRoot, resourceFile, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        operations: "list,view,new,edit",
        "resource-file": resourceFile,
        "resource-export": "customerResource",
        "display-fields": "firstName,email"
      }
    });

    assert.equal(context.__JSKIT_UI_LIST_DATA_COLUMN_COUNT__, "2");
    assert.match(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /<th>First Name<\/th>/);
    assert.match(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /<th>Email<\/th>/);
    assert.doesNotMatch(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /<th>Id<\/th>/);
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /record\.firstName/);
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /record\.email/);
    assert.doesNotMatch(context.__JSKIT_UI_VIEW_COLUMNS__, /record\.vip/);

    const createFields = JSON.parse(context.__JSKIT_UI_CREATE_FORM_FIELDS__);
    const editFields = JSON.parse(context.__JSKIT_UI_EDIT_FORM_FIELDS__);
    assert.deepEqual(
      createFields.map((field) => field.key),
      ["firstName", "email"]
    );
    assert.deepEqual(
      editFields.map((field) => field.key),
      ["firstName", "email"]
    );
  });
});

test("buildUiTemplateContext fails when display-fields includes unknown keys", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/customerResource.js";
    await writeResource(appRoot, resourceFile, FULL_RESOURCE_SOURCE);

    await assert.rejects(
      () =>
        buildUiTemplateContext({
          appRoot,
          options: {
            namespace: "customers-ui",
            "api-path": "/crud/customers",
            operations: "list,view,new,edit",
            "resource-file": resourceFile,
            "resource-export": "customerResource",
            "display-fields": "firstName,unknownField"
          }
        }),
      /display-fields" includes unsupported field\(s\)/
    );
  });
});

test("buildUiTemplateContext supports list-only resources when operations=list", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/listOnlyResource.js";
    await writeResource(
      appRoot,
      resourceFile,
      `const listOnlyResource = {
  operations: {
    list: {
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  fullName: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  }
};

export { listOnlyResource };
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        operations: "list",
        "resource-file": resourceFile,
        "resource-export": "listOnlyResource"
      }
    });

    assert.equal(context.__JSKIT_UI_HAS_LIST_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_VIEW_ROUTE__, "false");
    assert.equal(context.__JSKIT_UI_HAS_NEW_ROUTE__, "false");
    assert.equal(context.__JSKIT_UI_HAS_EDIT_ROUTE__, "false");
    assert.equal(context.__JSKIT_UI_LIST_DATA_COLUMN_COUNT__, "2");
    assert.equal(context.__JSKIT_UI_CREATE_FORM_FIELDS__, "[]");
    assert.equal(context.__JSKIT_UI_EDIT_FORM_FIELDS__, "[]");
  });
});

test("buildUiTemplateContext supports view-only resources when operations=view", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/viewOnlyResource.js";
    await writeResource(
      appRoot,
      resourceFile,
      `const viewOnlyResource = {
  operations: {
    view: {
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            id: { type: "integer" },
            fullName: { type: "string" }
          }
        }
      }
    }
  }
};

export { viewOnlyResource };
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        operations: "view",
        "resource-file": resourceFile,
        "resource-export": "viewOnlyResource"
      }
    });

    assert.equal(context.__JSKIT_UI_HAS_LIST_ROUTE__, "false");
    assert.equal(context.__JSKIT_UI_HAS_VIEW_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_NEW_ROUTE__, "false");
    assert.equal(context.__JSKIT_UI_HAS_EDIT_ROUTE__, "false");
    assert.equal(context.__JSKIT_UI_RECORD_CHANGED_EVENT__, "\"customers.record.changed\"");
  });
});

test("buildUiTemplateContext fails when operations option is invalid", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/customerResource.js";
    await writeResource(appRoot, resourceFile, FULL_RESOURCE_SOURCE);

    await assert.rejects(
      () =>
        buildUiTemplateContext({
          appRoot,
          options: {
            namespace: "customers-ui",
            "api-path": "/crud/customers",
            operations: "create",
            "resource-file": resourceFile,
            "resource-export": "customerResource"
          }
        }),
      /operations" supports only: list, view, new, edit/
    );
  });
});
