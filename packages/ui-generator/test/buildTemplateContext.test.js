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

test("buildUiTemplateContext derives list/view placeholders from resource validators", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    await writeResource(
      appRoot,
      resourceFile,
      `const recordSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    firstName: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    vip: { type: "boolean" }
  },
  additionalProperties: false
};

const contactsResource = {
  operations: {
    list: {
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: recordSchema
            },
            nextCursor: { type: ["string", "null"] }
          },
          additionalProperties: false
        }
      }
    },
    view: {
      outputValidator: {
        schema: recordSchema
      }
    }
  }
};

export { contactsResource };
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        operations: "list,view",
        "resource-file": resourceFile,
        "resource-export": "contactsResource"
      }
    });

    assert.equal(context.__JSKIT_UI_LIST_DATA_COLUMN_COUNT__, "4");
    assert.match(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /<th>First Name<\/th>/);
    assert.match(context.__JSKIT_UI_LIST_ROW_COLUMNS__, /record\.createdAt/);
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /record\.vip/);
    assert.equal(context.__JSKIT_UI_LIST_RECORD_ID_EXPR__, "record.id");
    assert.equal(context.__JSKIT_UI_VIEW_PRIMARY_ACCESSOR__, "record.value.firstName");
    assert.equal(context.__JSKIT_UI_HAS_LIST_ROUTE__, "true");
  });
});

test("buildUiTemplateContext fails when resource misses operations.view", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/missingViewResource.js";
    await writeResource(
      appRoot,
      resourceFile,
      `const missingViewResource = {
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
                  id: { type: "integer" }
                }
              }
            },
            nextCursor: { type: ["string", "null"] }
          }
        }
      }
    }
  }
};

export { missingViewResource };
`
    );

    await assert.rejects(
      () =>
        buildUiTemplateContext({
          appRoot,
          options: {
            operations: "view",
            "resource-file": resourceFile,
            "resource-export": "missingViewResource"
          }
        }),
      /missing operations\.view/
    );
  });
});

test("buildUiTemplateContext fails when operations option is invalid", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    await writeResource(
      appRoot,
      resourceFile,
      `const contactResource = {
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
                  id: { type: "integer" }
                }
              }
            },
            nextCursor: { type: ["string", "null"] }
          }
        }
      }
    },
    view: {
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            id: { type: "integer" }
          }
        }
      }
    }
  }
};

export { contactResource };
`
    );

    await assert.rejects(
      () =>
        buildUiTemplateContext({
          appRoot,
          options: {
            operations: "create",
            "resource-file": resourceFile,
            "resource-export": "contactResource"
          }
        }),
      /operations" supports only/
    );
  });
});
