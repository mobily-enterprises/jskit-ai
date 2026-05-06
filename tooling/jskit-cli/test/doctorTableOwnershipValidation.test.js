import assert from "node:assert/strict";
import {
  mkdir,
  writeFile
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

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

async function installFakeKnex(appRoot, {
  tables = [],
  columns = {},
  foreignKeys = []
} = {}) {
  const normalizedColumns = Object.fromEntries(
    Object.entries(columns).map(([tableName, columnNames]) => [
      tableName,
      Array.isArray(columnNames) ? columnNames : []
    ])
  );
  await writeAppFile(
    appRoot,
    "node_modules/knex/package.json",
    `${JSON.stringify(
      {
        name: "knex",
        version: "0.0.0-test",
        main: "index.js"
      },
      null,
      2
    )}\n`
  );

  await writeAppFile(
    appRoot,
    "node_modules/knex/index.js",
    `module.exports = function createKnex() {
  const tables = ${JSON.stringify(tables)};
  const columns = ${JSON.stringify(normalizedColumns)};
  const foreignKeys = ${JSON.stringify(foreignKeys)};
  return {
    async raw(sql) {
      if (/information_schema\\.TABLES/i.test(String(sql || ""))) {
        return [tables.map((tableName) => ({ tableName })), []];
      }
      if (/information_schema\\.COLUMNS/i.test(String(sql || ""))) {
        return [Object.entries(columns).flatMap(([tableName, columnNames]) => columnNames.map((columnName) => ({ tableName, columnName }))), []];
      }
      if (/information_schema\\.KEY_COLUMN_USAGE/i.test(String(sql || ""))) {
        return [foreignKeys.map((entry) => ({ ...entry })), []];
      }
      if (/pg_tables/i.test(String(sql || ""))) {
        return {
          rows: tables.map((tableName) => ({ tableName }))
        };
      }
      if (/information_schema\\.columns/i.test(String(sql || ""))) {
        return {
          rows: Object.entries(columns).flatMap(([tableName, columnNames]) => columnNames.map((columnName) => ({ tableName, columnName })))
        };
      }
      if (/constraint_type\\s*=\\s*'FOREIGN KEY'/i.test(String(sql || ""))) {
        return {
          rows: foreignKeys.map((entry) => ({ ...entry }))
        };
      }
      throw new Error("Unexpected raw query: " + String(sql || ""));
    },
    async destroy() {}
  };
};
`
  );
}

async function writeKnexfile(appRoot, { client = "mysql2" } = {}) {
  await writeAppFile(
    appRoot,
    "knexfile.js",
    `export default {
  client: ${JSON.stringify(client)},
  connection: {}
};
`
  );
}

async function writeLockFile(appRoot, installedPackageIds = []) {
  const installedPackages = Object.fromEntries(
    installedPackageIds.map((packageId) => [packageId, {}])
  );
  await writeAppFile(
    appRoot,
    ".jskit/lock.json",
    `${JSON.stringify(
      {
        lockVersion: 1,
        installedPackages
      },
      null,
      2
    )}\n`
  );
}

async function writePackageDescriptor(appRoot, packageDirectoryName, descriptorSource, extraFiles = {}) {
  await writeAppFile(
    appRoot,
    `packages/${packageDirectoryName}/package.json`,
    `${JSON.stringify(
      {
        name: `@local/${packageDirectoryName}`,
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`
  );
  await writeAppFile(appRoot, `packages/${packageDirectoryName}/package.descriptor.mjs`, descriptorSource);

  for (const [relativePath, body] of Object.entries(extraFiles)) {
    await writeAppFile(appRoot, `packages/${packageDirectoryName}/${relativePath}`, body);
  }
}

function createCrudProviderStub(ownershipFilter = "public", className = "CrudProvider") {
  return `const CRUD_MODULE_CONFIG = Object.freeze({
  ownershipFilter: ${JSON.stringify(ownershipFilter)}
});
class ${className} {}
export { ${className} };
`;
}

test("doctor accepts live tables owned by generated CRUD metadata", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-table-ownership-crud-app");
    await createMinimalApp(appRoot, { name: "doctor-table-ownership-crud-app" });
    await installFakeKnex(appRoot, { tables: ["contacts"] });
    await writeKnexfile(appRoot);
    await writeLockFile(appRoot, ["@local/contacts"]);

    await writePackageDescriptor(
      appRoot,
      "contacts",
      `export default Object.freeze({
  packageId: "@local/contacts",
  version: "0.1.0",
  kind: "runtime",
  capabilities: {
    provides: ["crud.contacts"],
    requires: []
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/ContactsProvider.js",
          export: "ContactsProvider"
        }
      ]
    }
  },
  metadata: {
    jskit: {
      scaffoldShape: "crud-server-v1",
      tableOwnership: {
        tables: [
          {
            tableName: "contacts",
            provenance: "crud-server-generator",
            ownerKind: "crud-package"
          }
        ]
      }
    },
    apiSummary: {
      containerTokens: {
        server: ["repository.contacts", "crud.contacts"]
      }
    }
  },
  mutations: {
    files: []
      }
});
`,
      {
        "src/server/ContactsProvider.js": createCrudProviderStub("public", "ContactsProvider")
      }
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

test("doctor flags live tables without CRUD/package ownership or explicit exception", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-table-ownership-missing-app");
    await createMinimalApp(appRoot, { name: "doctor-table-ownership-missing-app" });
    await installFakeKnex(appRoot, { tables: ["contacts"] });
    await writeKnexfile(appRoot);

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.match(
      String(payload.issues[0] || ""),
      /\[table-ownership:missing-owner\] live database table "contacts" has no declared owner/
    );
  });
});

test("doctor accepts explicit narrow non-CRUD table exceptions", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-table-ownership-exception-app");
    await createMinimalApp(appRoot, { name: "doctor-table-ownership-exception-app" });
    await installFakeKnex(appRoot, { tables: ["user_program_assignments"] });
    await writeKnexfile(appRoot);
    await writeAppFile(
      appRoot,
      ".jskit/table-ownership.json",
      `${JSON.stringify(
        {
          version: 1,
          exceptions: [
            {
              tableName: "user_program_assignments",
              category: "workflow-state",
              owner: "packages/program-assignment",
              reason: "Workflow-owned assignment aggregate."
            }
          ]
        },
        null,
        2
      )}\n`
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

test("doctor rejects invalid table exception categories", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-table-ownership-invalid-exception-app");
    await createMinimalApp(appRoot, { name: "doctor-table-ownership-invalid-exception-app" });
    await installFakeKnex(appRoot, { tables: ["user_program_assignments"] });
    await writeKnexfile(appRoot);
    await writeAppFile(
      appRoot,
      ".jskit/table-ownership.json",
      `${JSON.stringify(
        {
          version: 1,
          exceptions: [
            {
              tableName: "user_program_assignments",
              category: "misc",
              owner: "packages/program-assignment",
              reason: "Should fail."
            }
          ]
        },
        null,
        2
      )}\n`
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.match(
      String(payload.issues[0] || ""),
      /\.jskit\/table-ownership\.json table "user_program_assignments" must use one of:/
    );
  });
});

test("doctor allows the baseline users package provenance for the users table", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-table-ownership-users-app");
    await createMinimalApp(appRoot, { name: "doctor-table-ownership-users-app" });
    await installFakeKnex(appRoot, { tables: ["users"] });
    await writeKnexfile(appRoot);
    await writeLockFile(appRoot, ["@local/users"]);

    await writePackageDescriptor(
      appRoot,
      "users",
      `export default Object.freeze({
  packageId: "@local/users",
  version: "0.1.0",
  kind: "runtime",
  capabilities: {
    provides: ["crud.users"],
    requires: []
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/UsersProvider.js",
          export: "UsersProvider"
        }
      ]
    }
  },
  metadata: {
    jskit: {
      scaffoldShape: "users-core-crud-v1",
      tableOwnership: {
        tables: [
          {
            tableName: "users",
            provenance: "users-core-template",
            ownerKind: "baseline-crud"
          }
        ]
      }
    },
    apiSummary: {
      containerTokens: {
        server: ["repository.users", "crud.users"]
      }
    }
  },
  mutations: {
    files: []
  }
});
`,
      {
        "src/server/UsersProvider.js": createCrudProviderStub("public", "UsersProvider")
      }
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

test("doctor flags direct knex in app-owned packages outside explicit exception lanes", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-direct-knex-app");
    await createMinimalApp(appRoot, { name: "doctor-direct-knex-app" });
    await installFakeKnex(appRoot, { tables: ["reports_cache"] });
    await writeKnexfile(appRoot);
    await writeAppFile(
      appRoot,
      ".jskit/table-ownership.json",
      `${JSON.stringify(
        {
          version: 1,
          exceptions: [
            {
              tableName: "reports_cache",
              category: "projection-cache",
              owner: "packages/reporting-engine",
              reason: "Projection cache owned by reporting workflow."
            }
          ]
        },
        null,
        2
      )}\n`
    );

    await writePackageDescriptor(
      appRoot,
      "reporting-engine",
      `export default Object.freeze({
  packageId: "@local/reporting-engine",
  version: "0.1.0",
  kind: "runtime",
  capabilities: {
    provides: ["feature.reporting-engine"],
    requires: []
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/ReportingEngineProvider.js",
          export: "ReportingEngineProvider"
        }
      ]
    }
  },
  metadata: {
    apiSummary: {
      containerTokens: {
        server: ["feature.reporting-engine.service"]
      }
    }
  },
  mutations: {
    files: []
  }
});
`,
      {
        "src/server/ReportingEngineProvider.js": "class ReportingEngineProvider {}\nexport { ReportingEngineProvider };\n",
        "src/server/repository.js": "function createRepository({ knex } = {}) { return knex(\"reports_cache\"); }\nexport { createRepository };\n"
      }
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.match(
      payload.issues.join("\n"),
      /\[persistence-lane:direct-knex\] app-owned runtime code must stay on generated CRUD or internal json-rest-api by default/
    );
  });
});

test("doctor flags CRUD tables whose ownership filter requires a direct owner column", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-crud-missing-owner-column-app");
    await createMinimalApp(appRoot, { name: "doctor-crud-missing-owner-column-app" });
    await installFakeKnex(appRoot, {
      tables: ["contacts"],
      columns: {
        contacts: ["id", "name"]
      }
    });
    await writeKnexfile(appRoot);
    await writeLockFile(appRoot, ["@local/contacts"]);

    await writePackageDescriptor(
      appRoot,
      "contacts",
      `export default Object.freeze({
  packageId: "@local/contacts",
  version: "0.1.0",
  kind: "runtime",
  capabilities: {
    provides: ["crud.contacts"],
    requires: []
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/ContactsProvider.js",
          export: "ContactsProvider"
        }
      ]
    }
  },
  metadata: {
    jskit: {
      scaffoldShape: "crud-server-v1",
      tableOwnership: {
        tables: [
          {
            tableName: "contacts",
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
});
`,
      {
        "src/server/ContactsProvider.js": createCrudProviderStub("workspace", "ContactsProvider")
      }
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.match(
      payload.issues.join("\n"),
      /ContactsProvider\.js: \[crud-ownership:missing-owner-columns\] ownershipFilter "workspace" requires live table "contacts" to carry direct owner column\(s\) "workspace_id"/
    );
  });
});

test("doctor flags workflow-state tables that inherit user ownership through parent foreign keys", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-inherited-owner-workflow-app");
    await createMinimalApp(appRoot, { name: "doctor-inherited-owner-workflow-app" });
    await installFakeKnex(appRoot, {
      tables: ["user_program_assignments", "user_program_assignment_revisions"],
      columns: {
        user_program_assignments: ["id", "user_id"],
        user_program_assignment_revisions: ["id", "user_program_assignment_id"]
      },
      foreignKeys: [
        {
          tableName: "user_program_assignment_revisions",
          columnName: "user_program_assignment_id",
          referencedTableName: "user_program_assignments",
          referencedColumnName: "id"
        }
      ]
    });
    await writeKnexfile(appRoot);
    await writeAppFile(
      appRoot,
      ".jskit/table-ownership.json",
      `${JSON.stringify(
        {
          version: 1,
          exceptions: [
            {
              tableName: "user_program_assignments",
              category: "workflow-state",
              owner: "packages/program-assignment",
              reason: "Assignment aggregate."
            },
            {
              tableName: "user_program_assignment_revisions",
              category: "workflow-state",
              owner: "packages/program-assignment",
              reason: "Assignment revision history."
            }
          ]
        },
        null,
        2
      )}\n`
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.match(
      payload.issues.join("\n"),
      /\[table-ownership:inherited-owner\] live database table "user_program_assignment_revisions" reaches user ownership only via foreign-key chain user_program_assignment_revisions -> user_program_assignments but lacks direct owner column "user_id"\. Materialize the owner on the row instead of filtering through parent relationships\. .jskit\/table-ownership\.json category "workflow-state" does not exempt inherited ownership\./
    );
  });
});

test("doctor allows auxiliary join tables to inherit ownership without direct owner columns", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-inherited-owner-join-table-app");
    await createMinimalApp(appRoot, { name: "doctor-inherited-owner-join-table-app" });
    await installFakeKnex(appRoot, {
      tables: ["products", "product_booking_steps"],
      columns: {
        products: ["id", "workspace_id"],
        product_booking_steps: ["id", "product_id"]
      },
      foreignKeys: [
        {
          tableName: "product_booking_steps",
          columnName: "product_id",
          referencedTableName: "products",
          referencedColumnName: "id"
        }
      ]
    });
    await writeKnexfile(appRoot);
    await writeLockFile(appRoot, ["@local/products"]);
    await writePackageDescriptor(
      appRoot,
      "products",
      `export default Object.freeze({
  packageId: "@local/products",
  version: "0.1.0",
  kind: "runtime",
  capabilities: {
    provides: ["crud.products"],
    requires: []
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/ProductsProvider.js",
          export: "ProductsProvider"
        }
      ]
    }
  },
  metadata: {
    jskit: {
      scaffoldShape: "crud-server-v1",
      tableOwnership: {
        tables: [
          {
            tableName: "products",
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
});
`,
      {
        "src/server/ProductsProvider.js": createCrudProviderStub("workspace", "ProductsProvider")
      }
    );
    await writeAppFile(
      appRoot,
      ".jskit/table-ownership.json",
      `${JSON.stringify(
        {
          version: 1,
          exceptions: [
            {
              tableName: "product_booking_steps",
              category: "join-table",
              owner: "packages/products",
              reason: "Link table between products and booking steps."
            }
          ]
        },
        null,
        2
      )}\n`
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
