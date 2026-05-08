import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildUiTemplateContext } from "../src/server/buildTemplateContext.js";

const JSON_REST_SCHEMA_PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL("../../../node_modules/json-rest-schema/package.json", import.meta.url))
);
const KERNEL_PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL("../../kernel/package.json", import.meta.url))
);
const RESOURCE_CORE_PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL("../../resource-core/package.json", import.meta.url))
);
const RESOURCE_CRUD_CORE_PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL("../../resource-crud-core/package.json", import.meta.url))
);

async function linkTestPackage(appRoot, packageName, packageDir) {
  const nodeModulesDir = path.join(appRoot, "node_modules");
  const targetPath = path.join(nodeModulesDir, packageName);
  await mkdir(nodeModulesDir, { recursive: true });
  await mkdir(path.dirname(targetPath), { recursive: true });
  await symlink(packageDir, targetPath, "dir");
}

function renderTopologyVariant(outlet, { linkRenderer = "" } = {}) {
  const rendererLines = linkRenderer
    ? `,
      renderers: {
        link: "${linkRenderer}"
      }`
    : "";
  return `{
      outlet: "${outlet}"${rendererLines}
    }`;
}

function renderTopologyEntry({
  id = "",
  owner = "",
  surfaces = ["*"],
  defaultPlacement = false,
  outlet = "",
  linkRenderer = ""
} = {}) {
  const ownerLine = owner ? `    owner: "${owner}",\n` : "";
  const defaultLine = defaultPlacement ? "    default: true,\n" : "";
  return `  {
    id: "${id}",
${ownerLine}    surfaces: ${JSON.stringify(surfaces)},
${defaultLine}    variants: {
      compact: ${renderTopologyVariant(outlet, { linkRenderer })},
      medium: ${renderTopologyVariant(outlet, { linkRenderer })},
      expanded: ${renderTopologyVariant(outlet, { linkRenderer })}
    }
  }`;
}

async function writePlacementTopology(appRoot, entries = []) {
  const defaultEntries = [
    renderTopologyEntry({
      id: "shell.primary-nav",
      surfaces: ["*"],
      defaultPlacement: true,
      outlet: "shell-layout:primary-menu",
      linkRenderer: "local.main.ui.surface-aware-menu-link-item"
    }),
    renderTopologyEntry({
      id: "shell.secondary-nav",
      surfaces: ["*"],
      outlet: "shell-layout:secondary-menu",
      linkRenderer: "local.main.ui.surface-aware-menu-link-item"
    })
  ];
  await writeFile(
    path.join(appRoot, "src", "placementTopology.js"),
    `export default {
  placements: [
${[...defaultEntries, ...entries].join(",\n")}
  ]
};
`,
    "utf8"
  );
}

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "crud-ui-generator-"));
  try {
    await linkTestPackage(appRoot, "json-rest-schema", JSON_REST_SCHEMA_PACKAGE_DIR);
    await linkTestPackage(appRoot, "@jskit-ai/kernel", KERNEL_PACKAGE_DIR);
    await linkTestPackage(appRoot, "@jskit-ai/resource-core", RESOURCE_CORE_PACKAGE_DIR);
    await linkTestPackage(appRoot, "@jskit-ai/resource-crud-core", RESOURCE_CRUD_CORE_PACKAGE_DIR);
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
    />
    <ShellOutlet target="shell-layout:secondary-menu" />
  </div>
</template>
`,
      "utf8"
    );
    await writePlacementTopology(appRoot);
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

function buildCrudResourceSource({
  namespace = "customers",
  tableName = namespace,
  schemaSource = "",
  includeNamespace = true
} = {}) {
  return `import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const canonicalResource = defineCrudResource({
  namespace: ${JSON.stringify(namespace)},
  tableName: ${JSON.stringify(tableName)},
  schema: {
${schemaSource}
  },
  crudOperations: ["list", "view", "create", "patch"]
});

const resource = ${includeNamespace ? "canonicalResource" : "{ ...canonicalResource }"};
${includeNamespace ? "" : "delete resource.namespace;\n"}
export { resource };
`;
}

const FULL_RESOURCE_SCHEMA_SOURCE = `    firstName: {
      type: "string",
      required: true,
      maxLength: 120,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    email: {
      type: "string",
      required: true,
      maxLength: 160,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    vip: {
      type: "boolean",
      required: true,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    updatedAt: {
      type: "dateTime",
      required: true,
      operations: {
        output: { required: true }
      }
    }`;

const NULLABLE_BOOLEAN_RESOURCE_SCHEMA_SOURCE = `    firstName: {
      type: "string",
      required: true,
      maxLength: 120,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    reviewPassed: {
      type: "boolean",
      required: true,
      nullable: true,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    }`;

const SELECT_RESOURCE_SCHEMA_SOURCE = `    type: {
      type: "string",
      required: true,
      enum: ["dryer", "pallet racking", "freezer", "coolroom"],
      ui: {
        formControl: "select",
        options: [
          { value: "dryer", label: "Dryer" },
          { value: "pallet racking", label: "Pallet Racking" },
          { value: "freezer", label: "Freezer" },
          { value: "coolroom", label: "Coolroom" }
        ]
      },
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    }`;

const LOOKUP_RESOURCE_SCHEMA_SOURCE = `    serviceId: {
      type: "integer",
      nullable: true,
      relation: {
        kind: "lookup",
        namespace: "services",
        valueKey: "id",
        surfaceId: "console"
      },
      ui: {
        formControl: "autocomplete"
      },
      operations: {
        output: { required: false },
        create: { required: false },
        patch: { required: false }
      }
    },
    name: {
      type: "string",
      required: true,
      maxLength: 255,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    }`;

const TEMPORAL_RESOURCE_SCHEMA_SOURCE = `    dob: {
      type: "date",
      required: true,
      nullable: true,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    appointmentAt: {
      type: "dateTime",
      required: true,
      nullable: true,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    preferredTime: {
      type: "time",
      required: true,
      nullable: true,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    }`;

const FULL_RESOURCE_SOURCE = buildCrudResourceSource({
  namespace: "customers",
  tableName: "customers",
  schemaSource: FULL_RESOURCE_SCHEMA_SOURCE
});

const NULLABLE_BOOLEAN_RESOURCE_SOURCE = buildCrudResourceSource({
  namespace: "customers",
  tableName: "customers",
  schemaSource: NULLABLE_BOOLEAN_RESOURCE_SCHEMA_SOURCE
});

const SELECT_RESOURCE_SOURCE = buildCrudResourceSource({
  namespace: "locations",
  tableName: "locations",
  schemaSource: SELECT_RESOURCE_SCHEMA_SOURCE
});

const LOOKUP_RESOURCE_SOURCE = buildCrudResourceSource({
  namespace: "customers",
  tableName: "customers",
  schemaSource: LOOKUP_RESOURCE_SCHEMA_SOURCE
});

const TEMPORAL_RESOURCE_SOURCE = buildCrudResourceSource({
  namespace: "appointments",
  tableName: "appointments",
  schemaSource: TEMPORAL_RESOURCE_SCHEMA_SOURCE
});

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
    assert.equal(context.__JSKIT_UI_PARENT_TITLE_MODE__, "contextual");
    assert.match(context.__JSKIT_UI_LIST_PARENT_TITLE_IMPORT_LINE__, /useCrudListParentTitle/);
    assert.match(context.__JSKIT_UI_LIST_HEADING_TITLE_SETUP__, /Customers for /);
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

test("buildUiTemplateContext can suppress parent-title heading generation with parent-title none", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions({
        "parent-title": "none"
      })
    });

    assert.equal(context.__JSKIT_UI_PARENT_TITLE_MODE__, "none");
    assert.equal(context.__JSKIT_UI_LIST_PARENT_TITLE_IMPORT_LINE__, "");
    assert.doesNotMatch(context.__JSKIT_UI_LIST_HEADING_TITLE_SETUP__, /useCrudListParentTitle/);
    assert.match(context.__JSKIT_UI_LIST_HEADING_TITLE_SETUP__, /computed\(\(\) => "Customers"\)/);
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
    assert.equal(context.__JSKIT_UI_FORM_LOOKUP_PROP_DEFS__, "");
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
    assert.match(context.__JSKIT_UI_CREATE_LOOKUP_FORM_PROPS__, /^\n {4}:resolve-lookup-items=/);
    assert.match(context.__JSKIT_UI_EDIT_LOOKUP_FORM_PROPS__, /^\n {4}:resolve-lookup-items=/);
    assert.match(context.__JSKIT_UI_CREATE_LOOKUP_RUNTIME_SETUP__, /resolveLookupItems/);
    assert.match(context.__JSKIT_UI_EDIT_LOOKUP_RUNTIME_SETUP__, /resolveLookupItems/);
    assert.match(context.__JSKIT_UI_CREATE_LOOKUP_FORM_PROPS__, /resolve-lookup-items/);
    assert.match(context.__JSKIT_UI_EDIT_LOOKUP_FORM_PROPS__, /resolve-lookup-items/);
    assert.match(context.__JSKIT_UI_FORM_LOOKUP_PROP_DEFS__, /resolveLookupItems/);
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

test("buildUiTemplateContext maps json-rest temporal cast types to date-aware form inputs", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, TEMPORAL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions()
    });

    assert.match(context.__JSKIT_UI_CREATE_FORM_FIELDS__, /"key":"dob"[\s\S]*"inputType":"date"/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_FIELDS__, /"key":"appointmentAt"[\s\S]*"inputType":"datetime-local"/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_FIELDS__, /"key":"preferredTime"[\s\S]*"inputType":"time"/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /formState\.dob[\s\S]*type="date"/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /formState\.appointmentAt[\s\S]*type="datetime-local"/);
    assert.match(context.__JSKIT_UI_CREATE_FORM_COLUMNS__, /formState\.preferredTime[\s\S]*type="time"/);
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
      buildCrudResourceSource({
        namespace: "customers",
        tableName: "customers",
        schemaSource: FULL_RESOURCE_SCHEMA_SOURCE,
        includeNamespace: false
      })
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
    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_TARGET__, "shell.primary-nav");
    assert.equal(context.__JSKIT_UI_MENU_OWNER_LINE__, "");
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
    await writePlacementTopology(appRoot, [
      renderTopologyEntry({
        id: "page.section-nav",
        owner: "catalog",
        surfaces: ["admin"],
        outlet: "catalog:sub-pages",
        linkRenderer: "local.main.ui.surface-aware-menu-link-item"
      })
    ]);
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

    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_TARGET__, "page.section-nav");
    assert.equal(context.__JSKIT_UI_MENU_OWNER_LINE__, "    owner: \"catalog\",\n");
    assert.equal(context.__JSKIT_UI_MENU_ICON__, "mdi-view-list-outline");
    assert.equal(context.__JSKIT_UI_MENU_TO_PROP_LINE__, "      to: \"./products\",\n");
    assert.equal(context.__JSKIT_UI_MENU_WORKSPACE_SUFFIX__, "/catalog/products");
  });
});

test("buildUiTemplateContext prefers an outlet-declared default link token and omits fragile relative to output", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);
    await writePlacementTopology(appRoot, [
      renderTopologyEntry({
        id: "page.section-nav",
        owner: "admin-settings",
        surfaces: ["admin"],
        outlet: "admin-settings:primary-menu",
        linkRenderer: "local.main.ui.surface-aware-menu-link-item"
      })
    ]);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/settings.vue",
      `<template>
  <section>
    <ShellOutlet target="admin-settings:primary-menu" />
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

    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_TARGET__, "page.section-nav");
    assert.equal(context.__JSKIT_UI_MENU_OWNER_LINE__, "    owner: \"admin-settings\",\n");
    assert.equal(context.__JSKIT_UI_MENU_TO_PROP_LINE__, "");
  });
});

test("buildUiTemplateContext honors explicit link-placement override", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    const context = await buildUiTemplateContext({
      appRoot,
      options: createOptions({
        "link-placement": "shell.secondary-nav"
      })
    });

    assert.equal(context.__JSKIT_UI_MENU_PLACEMENT_TARGET__, "shell.secondary-nav");
    assert.equal(context.__JSKIT_UI_MENU_OWNER_LINE__, "");
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

test("buildUiTemplateContext validates parent-title against the supported modes", async () => {
  await withTempApp(async (appRoot) => {
    await writeResource(appRoot, RESOURCE_FILE, FULL_RESOURCE_SOURCE);

    await assert.rejects(
      () =>
        buildUiTemplateContext({
          appRoot,
          options: createOptions({
            "parent-title": "always"
          })
        }),
      /parent-title" supports only: contextual, none/
    );
  });
});

test("crud ui templates derive JSON:API transport from the shared CRUD resource", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const templateRoot = path.resolve(testDirectory, "..", "templates", "src", "pages", "admin", "ui-generator");

  const listTemplateSource = await readFile(path.join(templateRoot, "ListElement.vue"), "utf8");
  const viewTemplateSource = await readFile(path.join(templateRoot, "ViewElement.vue"), "utf8");
  const newTemplateSource = await readFile(path.join(templateRoot, "NewElement.vue"), "utf8");
  const editTemplateSource = await readFile(path.join(templateRoot, "EditElement.vue"), "utf8");
  const newWrapperTemplateSource = await readFile(path.join(templateRoot, "NewWrapperElement.vue"), "utf8");
  const editWrapperTemplateSource = await readFile(path.join(templateRoot, "EditWrapperElement.vue"), "utf8");

  assert.match(listTemplateSource, /resource: uiResource,/);
  assert.doesNotMatch(listTemplateSource, /const UI_LIST_TRANSPORT = Object\.freeze\(\{/);
  assert.doesNotMatch(listTemplateSource, /transport:\s*UI_LIST_TRANSPORT,/);

  assert.match(viewTemplateSource, /import \{ resource as uiResource \} from/);
  assert.match(viewTemplateSource, /resource: uiResource,/);
  assert.doesNotMatch(viewTemplateSource, /const UI_VIEW_TRANSPORT = Object\.freeze\(\{/);
  assert.doesNotMatch(viewTemplateSource, /transport:\s*UI_VIEW_TRANSPORT,/);

  assert.match(newTemplateSource, /resource: uiResource,/);
  assert.doesNotMatch(newTemplateSource, /const UI_CREATE_TRANSPORT = Object\.freeze\(\{/);
  assert.doesNotMatch(newTemplateSource, /transport:\s*UI_CREATE_TRANSPORT,/);

  assert.match(editTemplateSource, /resource: uiResource,/);
  assert.doesNotMatch(editTemplateSource, /const UI_EDIT_TRANSPORT = Object\.freeze\(\{/);
  assert.doesNotMatch(editTemplateSource, /transport:\s*UI_EDIT_TRANSPORT,/);

  assert.match(newWrapperTemplateSource, /resource: uiResource,/);
  assert.doesNotMatch(newWrapperTemplateSource, /const UI_CREATE_TRANSPORT = Object\.freeze\(\{/);
  assert.doesNotMatch(newWrapperTemplateSource, /transport:\s*UI_CREATE_TRANSPORT,/);

  assert.match(editWrapperTemplateSource, /resource: uiResource,/);
  assert.doesNotMatch(editWrapperTemplateSource, /const UI_EDIT_TRANSPORT = Object\.freeze\(\{/);
  assert.doesNotMatch(editWrapperTemplateSource, /transport:\s*UI_EDIT_TRANSPORT,/);
});
