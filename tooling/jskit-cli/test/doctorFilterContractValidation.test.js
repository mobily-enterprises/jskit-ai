import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";
import { writeJskitConfig } from "../../testUtils/jskitPackage.mjs";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot, { name = "tmp-app" } = {}) {
  await mkdir(appRoot, { recursive: true });
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
}

async function writeAppFile(appRoot, relativePath, sourceText) {
  const absolutePath = path.join(appRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, sourceText, "utf8");
}

async function writeStandardCrudPackage(appRoot, {
  packageName = "contacts",
  actionsSource = "",
  serverFiles = {}
} = {}) {
  const packageRoot = `packages/${packageName}`;
  await writeAppFile(
    appRoot,
    `${packageRoot}/package.json`,
    `${JSON.stringify(
      {
        name: `@local/${packageName}`,
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`
  );
  await writeJskitConfig(
    path.join(appRoot, packageRoot),
    `({
  kind: "runtime",
  capabilities: {
    provides: ["crud.${packageName}"],
    requires: []
  },
  runtime: {
    server: {
      providers: []
    }
  },
  metadata: {
    jskit: {
      scaffoldShape: "crud-server-v1",
      tableOwnership: {
        tables: [
          {
            tableName: "${packageName.replaceAll("-", "_")}",
            idColumn: "id",
            provenance: "crud-server-generator",
            ownerKind: "crud-package"
          }
        ]
      }
    }
  },
  mutations: {
    files: []
  }
})
`
  );
  const appManifestPath = path.join(appRoot, "package.json");
  const appPackageJson = JSON.parse(await readFile(appManifestPath, "utf8"));
  appPackageJson.dependencies ||= {};
  appPackageJson.dependencies[`@local/${packageName}`] = `file:${packageRoot}`;
  await writeFile(appManifestPath, `${JSON.stringify(appPackageJson, null, 2)}\n`, "utf8");
  await writeAppFile(
    appRoot,
    `${packageRoot}/src/server/actions.js`,
    actionsSource
  );

  for (const [relativePath, sourceText] of Object.entries(serverFiles)) {
    await writeAppFile(
      appRoot,
      `${packageRoot}/src/server/${relativePath}`,
      sourceText
    );
  }
}

function createCanonicalCrudActionsSource() {
  return `import {
  createStandardCrudListQueryValidators,
  createStandardCrudViewQueryValidators
} from "@jskit-ai/crud-core/server/listQueryValidators";

const resource = {};
const customActionInput = {};

const actions = [
  {
    id: "crud.contacts.list",
    input: [
      ...createStandardCrudListQueryValidators({ resource })
    ]
  },
  {
    id: "crud.contacts.view",
    input: [
      ...createStandardCrudViewQueryValidators()
    ]
  },
  {
    id: "contacts.rebuild-index",
    input: customActionInput
  }
];

export { actions };
`;
}

test("doctor flags inline structured filter definitions in page files", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-inline-filter-definitions-app");
    await createMinimalApp(appRoot, { name: "doctor-inline-filter-definitions-app" });

    await mkdir(path.join(appRoot, "src", "pages", "home", "contacts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "index.vue"),
      [
        "<script setup>",
        "const listFilters = useCrudListFilters({",
        "  onlyArchived: {",
        "    type: \"flag\",",
        "    label: \"Archived\"",
        "  }",
        "});",
        "</script>"
      ].join("\n"),
      "utf8"
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.equal(payload.issues.length, 1);
    assert.match(
      String(payload.issues[0] || ""),
      /src\/pages\/home\/contacts\/index\.vue:2: \[filters:shared-definition\] do not inline structured filter definitions in useCrudListFilters\(\.\.\.\)\. Put them in listFilters\.js or packages\/<crud>\/src\/shared\/<crud>ListFilters\.js/
    );
  });
});

test("doctor accepts generated page-local listFilters modules", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-page-local-filter-contract-app");
    await createMinimalApp(appRoot, { name: "doctor-page-local-filter-contract-app" });

    await mkdir(path.join(appRoot, "src", "pages", "home", "contacts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "listFilters.js"),
      [
        "import { defineCrudListFilters } from \"@jskit-ai/http-web/client/filters\";",
        "",
        "const listFilters = defineCrudListFilters({});",
        "",
        "export { listFilters };"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "index.vue"),
      [
        "<script setup>",
        "import { listFilters } from \"./listFilters.js\";",
        "",
        "const filterRuntime = useCrudListFilters(listFilters);",
        "const records = useCrudList({",
        "  queryParams: filterRuntime.queryParams",
        "});",
        "",
        "void records;",
        "</script>"
      ].join("\n"),
      "utf8"
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 0, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.deepEqual(payload.issues, []);
  });
});

test("doctor flags createQueryValidator calls without explicit invalidValues policy", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-filter-validator-mode-app");
    await createMinimalApp(appRoot, { name: "doctor-filter-validator-mode-app" });

    await mkdir(path.join(appRoot, "packages", "contacts", "src", "server"), { recursive: true });
    await writeFile(
      path.join(appRoot, "packages", "contacts", "src", "server", "listQueryValidators.js"),
      [
        "const contactsListFiltersRuntime = {};",
        "const contactsListFiltersQueryValidator = contactsListFiltersRuntime.createQueryValidator({});",
        "",
        "void contactsListFiltersQueryValidator;"
      ].join("\n"),
      "utf8"
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.equal(payload.issues.length, 1);
    assert.match(
      String(payload.issues[0] || ""),
      /packages\/contacts\/src\/server\/listQueryValidators\.js:2: \[filters:validator-mode\] createQueryValidator\(\.\.\.\) must be written explicitly as createQueryValidator\(\{ invalidValues: "reject" \| "discard" \}\)/
    );
  });
});

test("doctor accepts shared filter definitions imported into runtimes and explicit validator policy", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-valid-filter-contract-app");
    await createMinimalApp(appRoot, { name: "doctor-valid-filter-contract-app" });

    await mkdir(path.join(appRoot, "packages", "contacts", "src", "shared"), { recursive: true });
    await mkdir(path.join(appRoot, "packages", "contacts", "src", "server"), { recursive: true });
    await mkdir(path.join(appRoot, "src", "pages", "home", "contacts"), { recursive: true });

    await writeFile(
      path.join(appRoot, "packages", "contacts", "src", "shared", "contactListFilters.js"),
      [
        "export const CONTACTS_LIST_FILTER_DEFINITIONS = Object.freeze({",
        "  onlyArchived: {",
        "    type: \"flag\",",
        "    label: \"Archived\"",
        "  }",
        "});"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "packages", "contacts", "src", "server", "contactListFilterSupport.js"),
      [
        "import { CONTACTS_LIST_FILTER_DEFINITIONS } from \"../shared/contactListFilters.js\";",
        "",
        "const contactsListFiltersRuntime = createCrudListFilters(CONTACTS_LIST_FILTER_DEFINITIONS, {",
        "  columns: {",
        "    onlyArchived: \"archived\"",
        "  }",
        "});",
        "",
        "void contactsListFiltersRuntime;"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "packages", "contacts", "src", "server", "listQueryValidators.js"),
      [
        "const contactsListFiltersRuntime = {};",
        "const contactsListFiltersQueryValidator = contactsListFiltersRuntime.createQueryValidator({",
        "  invalidValues: \"reject\"",
        "});",
        "",
        "void contactsListFiltersQueryValidator;"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "index.vue"),
      [
        "<script setup>",
        "import { CONTACTS_LIST_FILTER_DEFINITIONS } from \"../../../../../packages/contacts/src/shared/contactListFilters.js\";",
        "",
        "const listFilters = useCrudListFilters(CONTACTS_LIST_FILTER_DEFINITIONS, {",
        "  presets: []",
        "});",
        "",
        "void listFilters;",
        "</script>"
      ].join("\n"),
      "utf8"
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 0, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.deepEqual(payload.issues, []);
  });
});

test("doctor flags stale query validator groups in standard generated CRUD packages", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-stale-crud-query-groups-app");
    await createMinimalApp(appRoot, { name: "doctor-stale-crud-query-groups-app" });
    await writeStandardCrudPackage(appRoot, {
      actionsSource: `import {
  listCursorPaginationQueryValidator,
  listSearchQueryValidator,
  lookupIncludeQueryValidator
} from "@jskit-ai/crud-core/server/listQueryValidators";

const actions = [
  {
    id: "crud.contacts.list",
    input: [
      listCursorPaginationQueryValidator,
      listSearchQueryValidator,
      lookupIncludeQueryValidator
    ]
  },
  {
    id: "crud.contacts.view",
    input: [
      lookupIncludeQueryValidator
    ]
  }
];

export { actions };
`
    });

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.equal(payload.issues.length, 2);
    assert.match(
      String(payload.issues[0] || ""),
      /\[crud-read-contract:list-query-group\]/
    );
    assert.match(
      String(payload.issues[1] || ""),
      /\[crud-read-contract:view-query-group\]/
    );
  });
});

test("doctor accepts canonical CRUD query groups without constraining custom actions", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-canonical-crud-query-groups-app");
    await createMinimalApp(appRoot, { name: "doctor-canonical-crud-query-groups-app" });
    await writeStandardCrudPackage(appRoot, {
      actionsSource: createCanonicalCrudActionsSource()
    });

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 0, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.deepEqual(payload.issues, []);
  });
});

test("doctor rejects the generic filter runtime in standard generated CRUD packages", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-generic-crud-filter-runtime-app");
    await createMinimalApp(appRoot, { name: "doctor-generic-crud-filter-runtime-app" });
    await writeStandardCrudPackage(appRoot, {
      actionsSource: createCanonicalCrudActionsSource(),
      serverFiles: {
        "contactListFilterSupport.js": `import {
  createCrudListFilters
} from "@jskit-ai/crud-core/server/listFilters";
import {
  CONTACTS_LIST_FILTER_DEFINITIONS
} from "../shared/contactListFilters.js";

const filterRuntime = createCrudListFilters(
  CONTACTS_LIST_FILTER_DEFINITIONS,
  {
    columns: {
      onlyArchived: "archived"
    }
  }
);
const queryValidator = filterRuntime.createQueryValidator({
  invalidValues: "reject"
});

export { queryValidator };
`,
        "../shared/contactListFilters.js": `export const CONTACTS_LIST_FILTER_DEFINITIONS = Object.freeze({
  onlyArchived: {
    type: "flag",
    label: "Archived"
  }
});
`
      }
    });

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.equal(payload.issues.length, 1);
    assert.match(
      String(payload.issues[0] || ""),
      /\[filters:generated-crud-contract\]/
    );
  });
});

test("doctor accepts the canonical filter contract in standard generated CRUD packages", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-canonical-crud-filter-contract-app");
    await createMinimalApp(appRoot, { name: "doctor-canonical-crud-filter-contract-app" });
    await writeStandardCrudPackage(appRoot, {
      actionsSource: createCanonicalCrudActionsSource(),
      serverFiles: {
        "contactListFilterSupport.js": `import {
  createCrudListFilterContract
} from "@jskit-ai/crud-core/server/listFilters";
import {
  CONTACTS_LIST_FILTER_DEFINITIONS
} from "../shared/contactListFilters.js";

const filterContract = createCrudListFilterContract(
  CONTACTS_LIST_FILTER_DEFINITIONS,
  {
    invalidValues: "reject",
    columns: {
      onlyArchived: "archived"
    }
  }
);

export { filterContract };
`,
        "../shared/contactListFilters.js": `export const CONTACTS_LIST_FILTER_DEFINITIONS = Object.freeze({
  onlyArchived: {
    type: "flag",
    label: "Archived"
  }
});
`
      }
    });

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 0, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.deepEqual(payload.issues, []);
  });
});
