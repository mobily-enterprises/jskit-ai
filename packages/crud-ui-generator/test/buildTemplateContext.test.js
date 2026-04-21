import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildUiTemplateContext } from "../src/server/buildTemplateContext.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "crud-ui-generator-"));
  try {
    await mkdir(path.join(appRoot, "config"), { recursive: true });
    await mkdir(path.join(appRoot, "src", "components"), { recursive: true });
    await writeFile(
      path.join(appRoot, "config", "public.js"),
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`,
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "components", "ShellLayout.vue"),
      `<template>
  <div>
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

async function writeFileInApp(appRoot, relativeFile, source) {
  const absoluteFile = path.join(appRoot, relativeFile);
  await mkdir(path.dirname(absoluteFile), { recursive: true });
  await writeFile(absoluteFile, source, "utf8");
}

const RESOURCE_FILE = "packages/customers/src/shared/customerResource.js";

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
  namespace: "customers",
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

const NULLABLE_BOOLEAN_RESOURCE_SOURCE = `const customerRecordSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    firstName: { type: "string" },
    reviewPassed: { type: ["boolean", "null"] }
  },
  additionalProperties: false
};

const customerBodySchema = {
  type: "object",
  properties: {
    firstName: { type: "string", maxLength: 120 },
    reviewPassed: { type: ["boolean", "null"] }
  },
  additionalProperties: false
};

const resource = {
  namespace: "customers",
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

const SELECT_RESOURCE_SOURCE = `const recordSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    type: { type: "string" }
  },
  additionalProperties: false
};

const bodySchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["dryer", "pallet racking", "freezer", "coolroom"] }
  },
  additionalProperties: false
};

const resource = {
  namespace: "locations",
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
    },
    create: {
      bodyValidator: {
        schema: bodySchema
      },
      outputValidator: {
        schema: recordSchema
      }
    },
    patch: {
      bodyValidator: {
        schema: bodySchema
      },
      outputValidator: {
        schema: recordSchema
      }
    }
  },
  fieldMeta: [
    {
      key: "type",
      ui: {
        formControl: "select",
        options: [
          { value: "dryer", label: "Dryer" },
          { value: "pallet racking", label: "Pallet Racking" },
          { value: "freezer", label: "Freezer" },
          { value: "coolroom", label: "Coolroom" }
        ]
      }
    }
  ]
};

export { resource };
`;

const LOOKUP_RESOURCE_SOURCE = `const recordSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    serviceId: { type: ["integer", "null"] },
    name: { type: "string" }
  },
  additionalProperties: false
};

const bodySchema = {
  type: "object",
  properties: {
    serviceId: { type: ["integer", "null"] },
    name: { type: "string", maxLength: 255 }
  },
  additionalProperties: false
};

const resource = {
  namespace: "customers",
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
    },
    create: {
      bodyValidator: {
        schema: bodySchema
      },
      outputValidator: {
        schema: recordSchema
      }
    },
    patch: {
      bodyValidator: {
        schema: bodySchema
      },
      outputValidator: {
        schema: recordSchema
      }
    }
  },
  fieldMeta: [
    {
      key: "serviceId",
      relation: {
        kind: "lookup",
        namespace: "services",
        valueKey: "id",
        surfaceId: "console"
      },
      ui: {
        formControl: "autocomplete"
      }
    }
  ]
};

export { resource };
`;

function createOptions(overrides = {}) {
  return {
    "target-root": "admin/customers",
    "resource-file": RESOURCE_FILE,
    operations: "list,view,new,edit",
    "id-param": "customerId",
    ...overrides
  };
}

test("buildUiTemplateContext defaults operations to the full CRUD set when omitted", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions({
        operations: ""
      })
    });

    assert.equal(context.__JSKIT_UI_HAS_LIST_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_VIEW_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_NEW_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_EDIT_ROUTE__, "true");
  });
});

test("buildUiTemplateContext derives CRUD placeholders from the explicit target-root and resource", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions()
    });

    assert.equal(context.__JSKIT_UI_RESOURCE_IMPORT_PATH__, "/packages/customers/src/shared/customerResource.js");
    assert.equal(context.__JSKIT_UI_API_BASE_URL__, "/customers");
    assert.equal(context.__JSKIT_UI_RECORD_ID_PARAM__, "customerId");
    assert.equal(context.__JSKIT_UI_RESOURCE_NAMESPACE__, "customers");
    assert.equal(context.__JSKIT_UI_RESOURCE_SINGULAR_TITLE__, "Customer");
    assert.equal(context.__JSKIT_UI_RESOURCE_PLURAL_TITLE__, "Customers");
    assert.equal(context.__JSKIT_UI_ROUTE_TITLE__, "Customers");
    assert.equal(context.__JSKIT_UI_FORM_COMPONENT_FILE__, "CrudAddEditForm.vue");
    assert.equal(context.__JSKIT_UI_FORM_FIELDS_FILE__, "CrudAddEditFormFields.js");
    assert.equal(context.__JSKIT_UI_SURFACE_ID__, "admin");
    assert.equal(context.__JSKIT_UI_HAS_LIST_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_VIEW_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_NEW_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_HAS_EDIT_ROUTE__, "true");
    assert.equal(context.__JSKIT_UI_MENU_WHEN_LINE__, "");
    assert.doesNotMatch(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /Id/);
    assert.doesNotMatch(context.__JSKIT_UI_LIST_ROW_COLUMNS__, /record\.id/);
    assert.match(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /First Name/);
    assert.match(context.__JSKIT_UI_LIST_ROW_COLUMNS__, /record\.firstName/);
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /view\.record\?\.firstName/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /formState\.firstName/);
    assert.match(context.__JSKIT_UI_EDIT_FORM_COLUMNS__, /formState\.email/);
    assert.equal(context.__JSKIT_UI_RECORD_CHANGED_EVENT__, "\"customers.record.changed\"");
    assert.equal(context.__JSKIT_UI_LIST_RECORD_ID_EXPR__, "item.id");
    assert.equal(context.__JSKIT_UI_VIEW_TITLE_FALLBACK_FIELD_KEY__, "\"firstName\"");
    assert.equal(context.__JSKIT_UI_LIST_PAGE_VIEW_URL__, "\"./:customerId\"");
    assert.equal(context.__JSKIT_UI_LIST_PAGE_EDIT_URL__, "\"./:customerId/edit\"");
    assert.equal(context.__JSKIT_UI_LIST_PAGE_NEW_URL__, "\"./new\"");
    assert.equal(context.__JSKIT_UI_NEW_PAGE_LIST_URL__, "\"..\"");
    assert.equal(context.__JSKIT_UI_NEW_PAGE_VIEW_URL__, "\"../:customerId\"");
    assert.equal(context.__JSKIT_UI_EDIT_PAGE_LIST_URL__, "\"../..\"");
    assert.equal(context.__JSKIT_UI_EDIT_PAGE_VIEW_URL__, "\"..\"");
    assert.equal(context.__JSKIT_UI_VIEW_PAGE_LIST_URL__, "\"..\"");
    assert.equal(context.__JSKIT_UI_VIEW_PAGE_EDIT_URL__, "\"./edit\"");
  });
});

test("buildUiTemplateContext keeps non-nullable booleans as switches", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions()
    });

    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /<v-switch/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /formState\.vip/);
  });
});

test("buildUiTemplateContext renders nullable booleans as tri-state selects by default", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, NULLABLE_BOOLEAN_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions()
    });

    assert.match(context.__JSKIT_UI_CREATE_FORM_FIELDS__, /"key":"reviewPassed"/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_FIELDS__, /"component":"select"/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_FIELDS__, /"nullable":true/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_FIELDS__, /"options":\[\{"label":"Unset","value":null\},\{"label":"Yes","value":true\},\{"label":"No","value":false\}\]/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /<v-select/);
    assert.doesNotMatch(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /<v-switch/);
  });
});

test("buildUiTemplateContext omits lookup runtime placeholders when form fields do not include lookups", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions()
    });

    assert.equal(context.__JSKIT_UI_CREATE_LOOKUP_IMPORT_LINE__, "");
    assert.equal(context.__JSKIT_UI_EDIT_LOOKUP_IMPORT_LINE__, "");
    assert.equal(context.__JSKIT_UI_CREATE_LOOKUP_RUNTIME_SETUP__, "");
    assert.equal(context.__JSKIT_UI_EDIT_LOOKUP_RUNTIME_SETUP__, "");
    assert.equal(context.__JSKIT_UI_CREATE_LOOKUP_FORM_PROPS__, "");
    assert.equal(context.__JSKIT_UI_EDIT_LOOKUP_FORM_PROPS__, "");
  });
});

test("buildUiTemplateContext indents direct-page form columns without changing shared form columns", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions()
    });

    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /^ {14}<v-col/m);
    assert.match(context.__JSKIT_UI_EDIT_FORM_COLUMNS__, /^ {14}<v-col/m);
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS_DIRECT__, /^ {12}<v-col/m);
    assert.match(context.__JSKIT_UI_EDIT_FORM_COLUMNS_DIRECT__, /^ {12}<v-col/m);
  });
});

test("buildUiTemplateContext includes lookup runtime placeholders when form fields include lookups", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, LOOKUP_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions({
        "display-fields": "serviceId"
      })
    });

    assert.match(context.__JSKIT_UI_CREATE_LOOKUP_IMPORT_LINE__, /createCrudLookupFieldRuntime/);
    assert.match(context.__JSKIT_UI_EDIT_LOOKUP_IMPORT_LINE__, /createCrudLookupFieldRuntime/);
    assert.match(context.__JSKIT_UI_CREATE_LOOKUP_RUNTIME_SETUP__, /resolveLookupItems/);
    assert.match(context.__JSKIT_UI_EDIT_LOOKUP_RUNTIME_SETUP__, /resolveLookupItems/);
    assert.match(context.__JSKIT_UI_CREATE_LOOKUP_FORM_PROPS__, /resolve-lookup-items/);
    assert.match(context.__JSKIT_UI_EDIT_LOOKUP_FORM_PROPS__, /resolve-lookup-items/);
  });
});

test("buildUiTemplateContext escapes select option bindings safely for Vue attributes", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, SELECT_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions()
    });

    assert.match(
      context.__JSKIT_UI_CREATE_FORM_COLUMNS__,
      /:items="\[\{&quot;value&quot;:&quot;dryer&quot;,&quot;label&quot;:&quot;Dryer&quot;\},\{&quot;value&quot;:&quot;pallet racking&quot;,&quot;label&quot;:&quot;Pallet Racking&quot;\},\{&quot;value&quot;:&quot;freezer&quot;,&quot;label&quot;:&quot;Freezer&quot;\},\{&quot;value&quot;:&quot;coolroom&quot;,&quot;label&quot;:&quot;Coolroom&quot;\}\]"/
    );
  });
});

test("buildUiTemplateContext derives menu auth visibility from the target surface policy", async () => {
  await withTempApp(async (appRoot) => {
    await writeFile(
      path.join(appRoot, "config", "public.js"),
      `export const config = {
  surfaceAccessPolicies: {
    authenticated: {
      requireAuth: true
    }
  },
  surfaceDefinitions: {
    app: { id: "app", pagesRoot: "app", enabled: true, accessPolicyId: "authenticated" }
  }
};
`,
      "utf8"
    );
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions({
        "target-root": "app/customers"
      })
    });

    assert.equal(context.__JSKIT_UI_MENU_WHEN_LINE__, "    when: ({ auth }) => auth?.authenticated === true\n");
  });
});

test("buildUiTemplateContext falls back to target-root leaf for namespace when resource.namespace is missing", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(
      appRoot,
      RESOURCE_FILE,
      FULL_RESOURCE_SOURCE.replace('  namespace: "customers",\n', "")
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions({
        "target-root": "admin/catalog/products"
      })
    });

    assert.equal(context.__JSKIT_UI_RESOURCE_NAMESPACE__, "products");
    assert.equal(context.__JSKIT_UI_API_BASE_URL__, "/products");
    assert.equal(context.__JSKIT_UI_ROUTE_TITLE__, "Products");
  });
});

test("buildUiTemplateContext filters rendered fields when display-fields is provided", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions({
        "display-fields": "firstName,email"
      })
    });

    assert.match(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /First Name/);
    assert.match(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /Email/);
    assert.doesNotMatch(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /Vip/);
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /view\.record\?\.firstName/);
    assert.match(context.__JSKIT_UI_VIEW_COLUMNS__, /view\.record\?\.email/);
    assert.doesNotMatch(context.__JSKIT_UI_VIEW_COLUMNS__, /view\.record\?\.vip/);
  });
});

test("buildUiTemplateContext keeps an explicitly requested id display field", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions({
        operations: "list,view",
        "display-fields": "id,firstName"
      })
    });

    assert.match(context.__JSKIT_UI_LIST_HEADER_COLUMNS__, /Id/);
    assert.match(context.__JSKIT_UI_LIST_ROW_COLUMNS__, /record\.id/);
  });
});

test("buildUiTemplateContext maps lookup metadata into form field definitions", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, LOOKUP_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions()
    });

    assert.match(context.__JSKIT_UI_CREATE_FORM_FIELDS__, /"relation":\{"kind":"lookup","namespace":"services"/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_FIELDS__, /"component":"lookup"/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_FIELDS__, /"lookupFormControl":"autocomplete"/);
    assert.match(context.__JSKIT_UI_EDIT_FORM_FIELDS__, /"containerKey":"lookups"/);
  });
});

test("buildUiTemplateContext resolves list placement from the app default shell target", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions()
    });

    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_ID__, "ui-generator.page.admin.customers.link");
    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_TARGET__, "shell-layout:primary-menu");
    assert.equal(context.__JSKIT_UI_MENU_COMPONENT_TOKEN__, "local.main.ui.surface-aware-menu-link-item");
    assert.equal(context.__JSKIT_UI_MENU_WORKSPACE_SUFFIX__, "/customers");
    assert.equal(context.__JSKIT_UI_MENU_NON_WORKSPACE_SUFFIX__, "/customers");
    assert.equal(context.__JSKIT_UI_MENU_TO_PROP_LINE__, "");
    assert.equal(context.__JSKIT_UI_MENU_LABEL__, "Customers");
    assert.equal(context.__JSKIT_UI_MENU_MARKER__, "jskit:crud-ui-generator.page.link:admin:/customers");
  });
});

test("buildUiTemplateContext infers tab placement and relative link-to from the nearest parent subpages host", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/catalog/index.vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="catalog:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions({
        "target-root": "admin/catalog/index/products"
      })
    });

    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_TARGET__, "catalog:sub-pages");
    assert.equal(context.__JSKIT_UI_MENU_COMPONENT_TOKEN__, "local.main.ui.tab-link-item");
    assert.equal(context.__JSKIT_UI_MENU_TO_PROP_LINE__, "      to: \"./products\",\n");
    assert.equal(context.__JSKIT_UI_MENU_WORKSPACE_SUFFIX__, "/catalog/products");
  });
});

test("buildUiTemplateContext prefers an outlet-declared default link token over subpage heuristics", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/settings.vue",
      `<template>
  <section>
    <ShellOutlet
      target="admin-settings:primary-menu"
      default-link-component-token="local.main.ui.surface-aware-menu-link-item"
    />
    <RouterView />
  </section>
</template>
`
    );

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions({
        "target-root": "admin/settings/customers"
      })
    });

    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_TARGET__, "admin-settings:primary-menu");
    assert.equal(context.__JSKIT_UI_MENU_COMPONENT_TOKEN__, "local.main.ui.surface-aware-menu-link-item");
    assert.equal(context.__JSKIT_UI_MENU_TO_PROP_LINE__, "      to: \"./customers\",\n");
  });
});

test("buildUiTemplateContext honors explicit link-placement override", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions({
        "link-placement": "shell-layout:secondary-menu"
      })
    });

    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_TARGET__, "shell-layout:secondary-menu");
    assert.equal(context.__JSKIT_UI_MENU_COMPONENT_TOKEN__, "local.main.ui.surface-aware-menu-link-item");
  });
});

test("buildUiTemplateContext accepts target-roots with a src/pages prefix", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions({
        "target-root": "src/pages/admin/customers"
      })
    });

    assert.equal(context.__JSKIT_UI_SURFACE_ID__, "admin");
    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_ID__, "ui-generator.page.admin.customers.link");
  });
});

test("buildUiTemplateContext validates operations against the supported CRUD set", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    await assert.rejects(
      () =>
        buildUiTemplateContext({
          appRoot,
          options: createOptions({
            operations: "list,archive"
          })
        }),
      /operations" supports only: list, view, new, edit/
    );
  });
});
