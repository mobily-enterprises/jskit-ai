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

async function writeShellLayout(appRoot, source = "") {
  const absoluteFile = path.join(appRoot, "src", "components", "ShellLayout.vue");
  await mkdir(path.dirname(absoluteFile), { recursive: true });
  await writeFile(
    absoluteFile,
    source ||
      `<template>
  <div>
    <ShellOutlet host="shell-layout" position="top-right" />
    <ShellOutlet host="shell-layout" position="primary-menu" default />
    <ShellOutlet host="shell-layout" position="secondary-menu" />
  </div>
</template>
`,
    "utf8"
  );
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
`;

const FULL_RESOURCE_WITH_LIST_REALTIME_SOURCE = `const customerRecordSchema = {
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

const resource = {
  operations: {
    list: {
      realtime: {
        events: ["customers.record.changed", "vets.record.changed"]
      },
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
      }
    });

    assert.match(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /<th>First Name<\/th>/);
    assert.doesNotMatch(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /<th>Updated At<\/th>/);
    assert.doesNotMatch(context.__JSKIT_UI_LIST_ROW_COLUMNS__, /record\.updatedAt/);
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /view\.record\?\.vip/);
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /view\.record\?\.updatedAt/);
    assert.equal(context.__JSKIT_UI_LIST_RECORD_ID_EXPR__, "item.id");
    assert.equal(context.__JSKIT_UI_RECORD_CHANGED_EVENT__, "\"customers.record.changed\"");
    assert.equal(context.__JSKIT_UI_LIST_REALTIME_EVENTS__, "[\"customers.record.changed\"]");
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
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /v-model="formRuntime\.form\.firstName"/);
    assert.match(context.__JSKIT_UI_EDIT_FORM_COLUMNS__, /v-model="formRuntime\.form\.email"/);
  });
});

test("buildUiTemplateContext includes hidden default list fields when explicitly selected", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/customerResource.js";
    await writeResource(appRoot, resourceFile, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        operations: "list,view",
        "resource-file": resourceFile,
        "display-fields": "updatedAt"
      }
    });

    assert.match(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /<th>Updated At<\/th>/);
    assert.match(context.__JSKIT_UI_LIST_ROW_COLUMNS__, /record\.updatedAt/);
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /view\.record\?\.updatedAt/);
  });
});

test('buildUiTemplateContext loads named export "resource" from resource-file', async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/customerResource.js";
    await writeResource(appRoot, resourceFile, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        operations: "list,view",
        "resource-file": resourceFile
      }
    });

    assert.equal(context.__JSKIT_UI_RECORD_CHANGED_EVENT__, "\"customers.record.changed\"");
    assert.equal(context.__JSKIT_UI_LIST_REALTIME_EVENTS__, "[\"customers.record.changed\"]");
    assert.equal(context.__JSKIT_UI_HAS_LIST_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_VIEW_ROUTE__, "true");
  });
});

test("buildUiTemplateContext exposes explicit list realtime events from resource operation config", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/customerResource.js";
    await writeResource(appRoot, resourceFile, FULL_RESOURCE_WITH_LIST_REALTIME_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        operations: "list",
        "resource-file": resourceFile,
      }
    });

    assert.equal(
      context.__JSKIT_UI_LIST_REALTIME_EVENTS__,
      "[\"customers.record.changed\",\"vets.record.changed\"]"
    );
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
        "display-fields": "firstName,email"
      }
    });

    assert.match(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /<th>First Name<\/th>/);
    assert.match(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /<th>Email<\/th>/);
    assert.doesNotMatch(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /<th>Id<\/th>/);
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /view\.record\?\.firstName/);
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /view\.record\?\.email/);
    assert.doesNotMatch(context.__JSKIT_UI_VIEW_COLUMNS__, /view\.record\?\.vip/);

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
      `const resource = {
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

export { resource };
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        operations: "list",
        "resource-file": resourceFile,
      }
    });

    assert.equal(context.__JSKIT_UI_HAS_LIST_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_VIEW_ROUTE__, "false");
    assert.equal(context.__JSKIT_UI_HAS_NEW_ROUTE__, "false");
    assert.equal(context.__JSKIT_UI_HAS_EDIT_ROUTE__, "false");
    assert.equal(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, "");
    assert.equal(context.__JSKIT_UI_EDIT_FORM_COLUMNS__, "");
    assert.equal(context.__JSKIT_UI_CREATE_FORM_FIELDS__, "[]");
    assert.equal(context.__JSKIT_UI_EDIT_FORM_FIELDS__, "[]");
  });
});

test("buildUiTemplateContext resolves field format from nullable anyOf schemas", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/nullableTemporalResource.js";
    await writeResource(
      appRoot,
      resourceFile,
      `const resource = {
  operations: {
    create: {
      bodyValidator: {
        schema: {
          type: "object",
          properties: {
            appointmentAt: {
              anyOf: [
                { type: "string", format: "date-time", minLength: 1 },
                { type: "null" }
              ]
            }
          },
          additionalProperties: false
        }
      },
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

export { resource };
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "appointments",
        "api-path": "/crud/appointments",
        operations: "new",
        "resource-file": resourceFile,
      }
    });

    const createFields = JSON.parse(context.__JSKIT_UI_CREATE_FORM_FIELDS__);
    assert.equal(createFields.length, 1);
    assert.equal(createFields[0].format, "date-time");
    assert.equal(createFields[0].inputType, "datetime-local");
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /type="datetime-local"/);
  });
});

test("buildUiTemplateContext supports view-only resources when operations=view", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/viewOnlyResource.js";
    await writeResource(
      appRoot,
      resourceFile,
      `const resource = {
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

export { resource };
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        operations: "view",
        "resource-file": resourceFile,
      }
    });

    assert.equal(context.__JSKIT_UI_HAS_LIST_ROUTE__, "false");
    assert.equal(context.__JSKIT_UI_HAS_VIEW_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_NEW_ROUTE__, "false");
    assert.equal(context.__JSKIT_UI_HAS_EDIT_ROUTE__, "false");
    assert.equal(context.__JSKIT_UI_RECORD_CHANGED_EVENT__, "\"customers.record.changed\"");
  });
});

test("buildUiTemplateContext maps lookup relations from resource fieldMeta into lookup form fields", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    await writeResource(
      appRoot,
      resourceFile,
      `const resource = {
  operations: {
    create: {
      bodyValidator: {
        schema: {
          type: "object",
          properties: {
            firstName: { type: "string" },
            vetId: { type: ["integer", "null"] }
          }
        }
      },
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            id: { type: "integer" }
          }
        }
      }
    },
    patch: {
      bodyValidator: {
        schema: {
          type: "object",
          properties: {
            firstName: { type: "string" },
            vetId: { type: ["integer", "null"] }
          }
        }
      },
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            id: { type: "integer" }
          }
        }
      }
    }
  },
  fieldMeta: [
    {
      key: "vetId",
      relation: {
        kind: "lookup",
        namespace: "vets",
        valueKey: "id",
        labelKey: "name"
      }
    }
  ]
};

export { resource };
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "contacts-ui",
        "api-path": "/crud/contacts",
        operations: "new,edit",
        "resource-file": resourceFile,
      }
    });

    const createFields = JSON.parse(context.__JSKIT_UI_CREATE_FORM_FIELDS__);
    const vetField = createFields.find((field) => field.key === "vetId");
    assert.ok(vetField);
    assert.equal(vetField.label, "Vet");
    assert.equal(vetField.component, "lookup");
    assert.deepEqual(vetField.relation, {
      kind: "lookup",
      namespace: "vets",
      valueKey: "id",
      labelKey: "name",
      containerKey: "lookups"
    });
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /<v-autocomplete/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /resolveLookupItems\("vetId", \{ selectedValue: formRuntime\.form\.vetId, selectedRecord: formRuntime\.addEdit\.resource\.data \}\)/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /:items='resolveLookupItems\("vetId", \{ selectedValue: formRuntime\.form\.vetId, selectedRecord: formRuntime\.addEdit\.resource\.data \}\)'/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /:search='resolveLookupSearch\("vetId"\)'/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /@update:search='setLookupSearch\("vetId", \$event\)'/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /:loading='resolveLookupLoading\("vetId"\)'/);

    assert.match(context.__JSKIT_UI_CREATE_FORM_FIELD_PUSH_LINES__, /UI_CREATE_FORM_FIELDS\.push\(\{/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_FIELD_PUSH_LINES__, /\"relation\": \{/);
  });
});

test("buildUiTemplateContext maps custom lookup container key from resource contract", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    await writeResource(
      appRoot,
      resourceFile,
      `const resource = {
  contract: {
    lookup: {
      containerKey: "lookupData"
    }
  },
  operations: {
    create: {
      bodyValidator: {
        schema: {
          type: "object",
          properties: {
            vetId: { type: ["integer", "null"] }
          }
        }
      },
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            id: { type: "integer" }
          }
        }
      }
    }
  },
  fieldMeta: [
    {
      key: "vetId",
      relation: {
        kind: "lookup",
        namespace: "vets",
        valueKey: "id"
      }
    }
  ]
};

export { resource };
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "contacts-ui",
        "api-path": "/contacts",
        operations: "new",
        "resource-file": resourceFile,
      }
    });

    const createFields = JSON.parse(context.__JSKIT_UI_CREATE_FORM_FIELDS__);
    const vetField = createFields.find((field) => field.key === "vetId");
    assert.ok(vetField);
    assert.equal(vetField.relation.containerKey, "lookupData");
  });
});

test("buildUiTemplateContext renders lookup display via shared runtime in list and view", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    await writeResource(
      appRoot,
      resourceFile,
      `const resource = {
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
                  vetId: { type: ["integer", "null"] },
                  lookups: { type: "object" }
                }
              }
            }
          }
        }
      }
    },
    view: {
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            id: { type: "integer" },
            vetId: { type: ["integer", "null"] },
            lookups: { type: "object" }
          }
        }
      }
    }
  },
  fieldMeta: [
    {
      key: "vetId",
      relation: {
        kind: "lookup",
        namespace: "vets",
        valueKey: "id",
        labelKey: "name"
      }
    }
  ]
};

export { resource };
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "contacts-ui",
        "api-path": "/contacts",
        operations: "list,view",
        "resource-file": resourceFile,
      }
    });

    assert.match(
      context.__JSKIT_UI_LIST_ROW_COLUMNS__,
      /records\.resolveFieldDisplay\(record, \{ key: "vetId", relation: \{ kind: "lookup", valueKey: "id", labelKey: "name", containerKey: "lookups" \} \}\)/
    );
    assert.match(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /<th>Vet<\/th>/);
    assert.match(
      context.__JSKIT_UI_VIEW_COLUMNS__,
      /view\.resolveFieldDisplay\(view\.record, \{ key: "vetId", relation: \{ kind: "lookup", valueKey: "id", labelKey: "name", containerKey: "lookups" \} \}\)/
    );
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /text-caption text-medium-emphasis">Vet</);
    assert.match(context.__JSKIT_UI_LIST_ROW_COLUMNS__, /record\.id/);
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /view\.record\?\.id/);
    assert.doesNotMatch(context.__JSKIT_UI_LIST_ROW_COLUMNS__, /record\.lookups/);
    assert.doesNotMatch(context.__JSKIT_UI_VIEW_COLUMNS__, /view\.record\?\.lookups/);
  });
});

test("buildUiTemplateContext normalizes legacy targetResource lookup metadata to namespace", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    await writeResource(
      appRoot,
      resourceFile,
      `const resource = {
  operations: {
    create: {
      bodyValidator: {
        schema: {
          type: "object",
          properties: {
            vetId: { type: ["integer", "null"] }
          }
        }
      },
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            id: { type: "integer" }
          }
        }
      }
    }
  },
  fieldMeta: [
    {
      key: "vetId",
      relation: {
        kind: "lookup",
        targetResource: "vets",
        valueKey: "id",
        labelKey: "name"
      }
    }
  ]
};

export { resource };
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "contacts-ui",
        "api-path": "/contacts",
        operations: "new",
        "resource-file": resourceFile,
      }
    });

    const createFields = JSON.parse(context.__JSKIT_UI_CREATE_FORM_FIELDS__);
    const vetField = createFields.find((field) => field.key === "vetId");
    assert.ok(vetField);
    assert.deepEqual(vetField.relation, {
      kind: "lookup",
      namespace: "vets",
      valueKey: "id",
      labelKey: "name",
      containerKey: "lookups"
    });
  });
});

test("buildUiTemplateContext supports lookup ui.formControl=select", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    await writeResource(
      appRoot,
      resourceFile,
      `const resource = {
  operations: {
    create: {
      bodyValidator: {
        schema: {
          type: "object",
          properties: {
            vetId: { type: ["integer", "null"] }
          }
        }
      },
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            id: { type: "integer" }
          }
        }
      }
    }
  },
  fieldMeta: [
    {
      key: "vetId",
      relation: {
        kind: "lookup",
        namespace: "vets",
        valueKey: "id"
      },
      ui: {
        formControl: "select"
      }
    }
  ]
};

export { resource };
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "contacts-ui",
        "api-path": "/contacts",
        operations: "new",
        "resource-file": resourceFile,
      }
    });

    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /<v-select/);
    assert.doesNotMatch(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /<v-autocomplete/);
    assert.doesNotMatch(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /resolveLookupSearch\("vetId"\)/);
    assert.doesNotMatch(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /setLookupSearch\("vetId", \$event\)/);
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
          }
        }),
      /operations" supports only: list, view, new, edit/
    );
  });
});

test("buildUiTemplateContext marks nearest route parent field as hidden route-bound in forms", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/addresses/src/shared/addressResource.js";
    await writeResource(
      appRoot,
      resourceFile,
      `const resource = {
  operations: {
    create: {
      bodyValidator: {
        schema: {
          type: "object",
          properties: {
            contactId: { type: "integer" },
            line1: { type: "string" }
          }
        }
      },
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            id: { type: "integer" }
          }
        }
      }
    },
    patch: {
      bodyValidator: {
        schema: {
          type: "object",
          properties: {
            contactId: { type: "integer" },
            line1: { type: "string" }
          }
        }
      },
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            id: { type: "integer" }
          }
        }
      }
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
};

export { resource };
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "addresses-ui",
        "api-path": "/addresses",
        "route-path": "contacts/[contactId]/addresses",
        "id-param": "addressId",
        operations: "new,edit",
        "resource-file": resourceFile,
        "display-fields": "line1"
      }
    });

    const createFields = JSON.parse(context.__JSKIT_UI_CREATE_FORM_FIELDS__);
    const editFields = JSON.parse(context.__JSKIT_UI_EDIT_FORM_FIELDS__);
    const createContactIdField = createFields.find((field) => field.key === "contactId");
    const editContactIdField = editFields.find((field) => field.key === "contactId");

    assert.equal(createContactIdField.hidden, true);
    assert.equal(createContactIdField.routeParamKey, "contactId");
    assert.equal(editContactIdField.hidden, true);
    assert.equal(editContactIdField.routeParamKey, "contactId");
    assert.doesNotMatch(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /formRuntime\.form\.contactId/);
    assert.doesNotMatch(context.__JSKIT_UI_EDIT_FORM_COLUMNS__, /formRuntime\.form\.contactId/);
  });
});

test("buildUiTemplateContext resolves menu placement from ShellLayout default target", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/customerResource.js";
    await writeResource(appRoot, resourceFile, FULL_RESOURCE_SOURCE);
    await writeShellLayout(
      appRoot,
      `<template>
  <div>
    <ShellOutlet host="shell-layout" position="top-right" default />
    <ShellOutlet host="shell-layout" position="primary-menu" />
  </div>
</template>
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        "route-path": "ops/customers",
        operations: "list",
        "resource-file": resourceFile,
      }
    });

    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_HOST__, "shell-layout");
    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_POSITION__, "top-right");
    assert.equal(context.__JSKIT_UI_MENU_COMPONENT_TOKEN__, "users.web.shell.surface-aware-menu-link-item");
  });
});

test("buildUiTemplateContext defaults list placement to container host when container is set", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/customerResource.js";
    await writeResource(appRoot, resourceFile, FULL_RESOURCE_SOURCE);
    await writeShellLayout(
      appRoot,
      `<template>
  <div>
    <ShellOutlet host="shell-layout" position="primary-menu" default />
    <ShellOutlet host="practice" position="sub-pages" />
  </div>
</template>
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        "route-path": "customers",
        container: "practice",
        operations: "list",
        "resource-file": resourceFile,
      }
    });

    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_HOST__, "practice");
    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_POSITION__, "sub-pages");
    assert.equal(context.__JSKIT_UI_MENU_COMPONENT_TOKEN__, "local.main.ui.tab-link-item");
  });
});

test("buildUiTemplateContext applies explicit placement override and validates target format", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/customerResource.js";
    await writeResource(appRoot, resourceFile, FULL_RESOURCE_SOURCE);
    await writeShellLayout(appRoot);

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        "route-path": "ops/customers",
        operations: "list",
        placement: "shell-layout:secondary-menu",
        "resource-file": resourceFile,
      }
    });
    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_POSITION__, "secondary-menu");

    await assert.rejects(
      () =>
        buildUiTemplateContext({
          appRoot,
          options: {
            namespace: "customers-ui",
            "api-path": "/crud/customers",
            "route-path": "ops/customers",
            operations: "list",
            placement: "invalid-placement",
            "resource-file": resourceFile,
          }
        }),
      /option "placement" must be in "host:position" format/
    );

    await assert.rejects(
      () =>
        buildUiTemplateContext({
          appRoot,
          options: {
            namespace: "customers-ui",
            "api-path": "/crud/customers",
            "route-path": "ops/customers",
            container: "practice/sub",
            operations: "list",
            "resource-file": resourceFile,
          }
        }),
      /option "container" must be a single host token/
    );
  });
});

test("buildUiTemplateContext allows placement component token override", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/customerResource.js";
    await writeResource(appRoot, resourceFile, FULL_RESOURCE_SOURCE);
    await writeShellLayout(appRoot);

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        "route-path": "ops/customers",
        operations: "list",
        placement: "shell-layout:secondary-menu",
        "placement-component-token": "local.main.ui.tab-link-item",
        "resource-file": resourceFile,
      }
    });

    assert.equal(context.__JSKIT_UI_MENU_COMPONENT_TOKEN__, "local.main.ui.tab-link-item");
  });
});

test("buildUiTemplateContext renders optional placement-to props line", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/customerResource.js";
    await writeResource(appRoot, resourceFile, FULL_RESOURCE_SOURCE);
    await writeShellLayout(appRoot);

    const defaultContext = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        "route-path": "ops/customers",
        operations: "list",
        placement: "shell-layout:secondary-menu",
        "resource-file": resourceFile,
      }
    });
    assert.equal(defaultContext.__JSKIT_UI_MENU_TO_PROP_LINE__, "");

    const explicitToContext = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        "route-path": "ops/customers",
        operations: "list",
        placement: "shell-layout:secondary-menu",
        "placement-to": "./pets",
        "resource-file": resourceFile,
      }
    });
    assert.equal(explicitToContext.__JSKIT_UI_MENU_TO_PROP_LINE__, "      to: \"./pets\",\n");
  });
});

test("buildUiTemplateContext strips route-group filesystem segments from menu URL suffix", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/customers/src/shared/customerResource.js";
    await writeResource(appRoot, resourceFile, FULL_RESOURCE_SOURCE);
    await writeShellLayout(appRoot);

    const context = await buildUiTemplateContext({
      appRoot,
      options: {
        namespace: "customers-ui",
        "api-path": "/crud/customers",
        "directory-prefix": "ops/(nestedChildren)",
        "route-path": "customers",
        operations: "list",
        placement: "shell-layout:secondary-menu",
        "resource-file": resourceFile
      }
    });

    assert.equal(context.__JSKIT_UI_MENU_WORKSPACE_SUFFIX__, "/ops/customers");
    assert.equal(context.__JSKIT_UI_MENU_NON_WORKSPACE_SUFFIX__, "/ops/customers");
  });
});
