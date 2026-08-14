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
import { writeJskitPackageMetadata } from "../../testUtils/jskitPackage.mjs";

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
  foreignKeys = [],
  primaryKeys = {}
} = {}) {
  const normalizedColumns = Object.fromEntries(
    Object.entries(columns).map(([tableName, columnNames]) => [
      tableName,
      Array.isArray(columnNames) ? columnNames : []
    ])
  );
  const normalizedPrimaryKeys = Object.fromEntries(
    tables.map((tableName) => [
      tableName,
      Array.isArray(primaryKeys[tableName]) ? primaryKeys[tableName] : ["id"]
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
  const primaryKeys = ${JSON.stringify(normalizedPrimaryKeys)};
  return {
    async raw(sql) {
      if (/information_schema\\.TABLES/i.test(String(sql || ""))) {
        return [tables.map((tableName) => ({ tableName })), []];
      }
      if (/information_schema\\.COLUMNS/i.test(String(sql || ""))) {
        return [Object.entries(columns).flatMap(([tableName, columnNames]) => columnNames.map((columnName) => ({ tableName, columnName }))), []];
      }
      if (/information_schema\\.KEY_COLUMN_USAGE/i.test(String(sql || "")) && /CONSTRAINT_NAME\\s*=\\s*'PRIMARY'/i.test(String(sql || ""))) {
        return [Object.entries(primaryKeys).flatMap(([tableName, columnNames]) => columnNames.map((columnName, index) => ({ tableName, columnName, ordinalPosition: index + 1 }))), []];
      }
      if (/information_schema\\.KEY_COLUMN_USAGE/i.test(String(sql || ""))) {
        return [foreignKeys.map((entry, index) => ({ constraintName: entry.constraintName || ("fk_" + index), ordinalPosition: entry.ordinalPosition || 1, ...entry })), []];
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
          rows: foreignKeys.map((entry, index) => ({ constraintName: entry.constraintName || ("fk_" + index), ordinalPosition: entry.ordinalPosition || 1, ...entry }))
        };
      }
      if (/constraint_type\\s*=\\s*'PRIMARY KEY'/i.test(String(sql || ""))) {
        return {
          rows: Object.entries(primaryKeys).flatMap(([tableName, columnNames]) => columnNames.map((columnName, index) => ({ tableName, columnName, ordinalPosition: index + 1 })))
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

async function declareInstalledPackages(appRoot, installedPackageIds = []) {
  const manifestPath = path.join(appRoot, "package.json");
  const packageJson = JSON.parse(await readFile(manifestPath, "utf8"));
  packageJson.dependencies ||= {};
  for (const packageId of installedPackageIds) {
    const packageDirectoryName = String(packageId).split("/").at(-1);
    packageJson.dependencies[packageId] = `file:packages/${packageDirectoryName}`;
  }
  await writeFile(manifestPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

async function writePackageMetadata(appRoot, packageDirectoryName, metadataExpression, extraFiles = {}) {
  const packageRoot = path.join(appRoot, "packages", packageDirectoryName);
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
  await writeJskitPackageMetadata(packageRoot, metadataExpression);

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

async function writeGeneratedCrudPackage(appRoot, {
  packageDirectoryName = "items",
  tableName = "items",
  idColumn = "id",
  ownershipFilter = "public"
} = {}) {
  const className = `${packageDirectoryName
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join("")}Provider`;
  await writePackageMetadata(
    appRoot,
    packageDirectoryName,
    `({
  packageId: "@local/${packageDirectoryName}",
  version: "0.1.0",
  kind: "runtime",
  capabilities: {
    provides: ["crud.${packageDirectoryName}"],
    requires: []
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/${className}.js",
          export: "${className}"
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
            tableName: "${tableName}",
            idColumn: "${idColumn}",
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
`,
    {
      [`src/server/${className}.js`]: createCrudProviderStub(ownershipFilter, className)
    }
  );
}

test("doctor accepts live tables owned by generated CRUD metadata", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-table-ownership-crud-app");
    await createMinimalApp(appRoot, { name: "doctor-table-ownership-crud-app" });
    await installFakeKnex(appRoot, { tables: ["contacts"] });
    await writeKnexfile(appRoot);
    await declareInstalledPackages(appRoot, ["@local/contacts"]);

    await writePackageMetadata(
      appRoot,
      "contacts",
      `({
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
})
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
    await declareInstalledPackages(appRoot, ["@local/users"]);

    await writePackageMetadata(
      appRoot,
      "users",
      `({
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
})
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

    await writePackageMetadata(
      appRoot,
      "reporting-engine",
      `({
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
})
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

test("doctor requires CRUD ownership filters to match direct reserved owner columns exactly", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-crud-missing-owner-column-app");
    await createMinimalApp(appRoot, { name: "doctor-crud-missing-owner-column-app" });
    await installFakeKnex(appRoot, {
      tables: ["contacts"],
      columns: {
        contacts: ["id", "user_id", "name"]
      }
    });
    await writeKnexfile(appRoot);
    await declareInstalledPackages(appRoot, ["@local/contacts"]);

    await writePackageMetadata(
      appRoot,
      "contacts",
      `({
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
})
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
    assert.match(
      payload.issues.join("\n"),
      /ContactsProvider\.js: \[crud-ownership:unexpected-owner-columns\] ownershipFilter "workspace" conflicts with reserved owner column\(s\) "user_id".*exact direct columns "workspace_id" and "user_id" define JSKIT ownership/s
    );
  });
});

test("doctor keeps noncanonical user foreign keys as domain relationships for explicitly owned CRUD tables", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-crud-domain-user-relationship-app");
    await createMinimalApp(appRoot, { name: "doctor-crud-domain-user-relationship-app" });
    await installFakeKnex(appRoot, {
      tables: ["users", "notification_outbox_items"],
      columns: {
        users: ["id"],
        notification_outbox_items: ["id", "workspace_id", "recipient_user_id"]
      },
      foreignKeys: [
        {
          tableName: "notification_outbox_items",
          columnName: "recipient_user_id",
          referencedTableName: "users",
          referencedColumnName: "id"
        }
      ]
    });
    await writeKnexfile(appRoot);
    await declareInstalledPackages(appRoot, ["@local/notification-outbox-items"]);

    await writePackageMetadata(
      appRoot,
      "notification-outbox-items",
      `({
  packageId: "@local/notification-outbox-items",
  version: "0.1.0",
  kind: "runtime",
  capabilities: {
    provides: ["crud.notification-outbox-items"],
    requires: []
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/NotificationOutboxItemsProvider.js",
          export: "NotificationOutboxItemsProvider"
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
            tableName: "notification_outbox_items",
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
`,
      {
        "src/server/NotificationOutboxItemsProvider.js": createCrudProviderStub(
          "workspace",
          "NotificationOutboxItemsProvider"
        )
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
              tableName: "users",
              category: "projection-cache",
              owner: "packages/users",
              reason: "User fixture referenced by the outbox recipient relationship."
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

test("doctor supports multiple CRUD providers in one package when table ownership metadata declares provider entrypoints", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-multi-provider-crud-app");
    await createMinimalApp(appRoot, { name: "doctor-multi-provider-crud-app" });
    await installFakeKnex(appRoot, {
      tables: ["google_rewarded_rules", "google_rewarded_watch_sessions"],
      columns: {
        google_rewarded_rules: ["id", "workspace_id"],
        google_rewarded_watch_sessions: ["id", "workspace_id"]
      }
    });
    await writeKnexfile(appRoot);
    await declareInstalledPackages(appRoot, ["@local/google-rewarded-core"]);

    await writePackageMetadata(
      appRoot,
      "google-rewarded-core",
      `({
  packageId: "@local/google-rewarded-core",
  version: "0.1.0",
  kind: "runtime",
  capabilities: {
    provides: ["crud.google-rewarded-rules", "crud.google-rewarded-watch-sessions"],
    requires: []
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/rules/GoogleRewardedRulesProvider.js",
          export: "GoogleRewardedRulesProvider"
        },
        {
          entrypoint: "src/server/watchSessions/GoogleRewardedWatchSessionsProvider.js",
          export: "GoogleRewardedWatchSessionsProvider"
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
            tableName: "google_rewarded_rules",
            provenance: "crud-server-generator",
            ownerKind: "crud-package",
            providerEntrypoint: "src/server/rules/GoogleRewardedRulesProvider.js",
            ownershipFilter: "workspace"
          },
          {
            tableName: "google_rewarded_watch_sessions",
            provenance: "crud-server-generator",
            ownerKind: "crud-package",
            providerEntrypoint: "src/server/watchSessions/GoogleRewardedWatchSessionsProvider.js",
            ownershipFilter: "workspace_user"
          }
        ]
      }
    }
  },
  mutations: {
    files: []
  }
})
`,
      {
        "src/server/rules/GoogleRewardedRulesProvider.js": createCrudProviderStub("workspace", "GoogleRewardedRulesProvider"),
        "src/server/watchSessions/GoogleRewardedWatchSessionsProvider.js": createCrudProviderStub("workspace_user", "GoogleRewardedWatchSessionsProvider")
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
      /GoogleRewardedWatchSessionsProvider\.js: \[crud-ownership:missing-owner-columns\] ownershipFilter "workspace_user" requires live table "google_rewarded_watch_sessions" to carry direct owner column\(s\) "user_id"/
    );
    assert.doesNotMatch(payload.issues.join("\n"), /google_rewarded_rules/);
  });
});

test("doctor rejects CRUD metadata whose ownership filter drifts from the provider code", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-crud-ownership-filter-mismatch-app");
    await createMinimalApp(appRoot, { name: "doctor-crud-ownership-filter-mismatch-app" });
    await installFakeKnex(appRoot, {
      tables: ["google_rewarded_watch_sessions"],
      columns: {
        google_rewarded_watch_sessions: ["id", "workspace_id", "user_id"]
      }
    });
    await writeKnexfile(appRoot);
    await declareInstalledPackages(appRoot, ["@local/google-rewarded-core"]);

    await writePackageMetadata(
      appRoot,
      "google-rewarded-core",
      `({
  packageId: "@local/google-rewarded-core",
  version: "0.1.0",
  kind: "runtime",
  capabilities: {
    provides: ["crud.google-rewarded-watch-sessions"],
    requires: []
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/watchSessions/GoogleRewardedWatchSessionsProvider.js",
          export: "GoogleRewardedWatchSessionsProvider"
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
            tableName: "google_rewarded_watch_sessions",
            provenance: "crud-server-generator",
            ownerKind: "crud-package",
            providerEntrypoint: "src/server/watchSessions/GoogleRewardedWatchSessionsProvider.js",
            ownershipFilter: "workspace"
          }
        ]
      }
    }
  },
  mutations: {
    files: []
  }
})
`,
      {
        "src/server/watchSessions/GoogleRewardedWatchSessionsProvider.js": createCrudProviderStub("workspace_user", "GoogleRewardedWatchSessionsProvider")
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
      /GoogleRewardedWatchSessionsProvider\.js: \[crud-ownership:ownership-filter-mismatch\] metadata declares ownershipFilter "workspace" for live table "google_rewarded_watch_sessions" but provider code uses "workspace_user"/
    );
    assert.doesNotMatch(payload.issues.join("\n"), /\[crud-ownership:missing-owner-columns\]/);
  });
});

test("doctor rejects CRUD metadata when the owning provider cannot be resolved", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-crud-provider-unresolved-app");
    await createMinimalApp(appRoot, { name: "doctor-crud-provider-unresolved-app" });
    await installFakeKnex(appRoot, {
      tables: ["contacts"],
      columns: {
        contacts: ["id", "workspace_id"]
      }
    });
    await writeKnexfile(appRoot);
    await declareInstalledPackages(appRoot, ["@local/contacts"]);

    await writePackageMetadata(
      appRoot,
      "contacts",
      `({
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
            ownerKind: "crud-package",
            providerEntrypoint: "src/server/ContactsProvider.js",
            ownershipFilter: "workspace"
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

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.match(
      payload.issues.join("\n"),
      /packages\/contacts\/package\.json: \[crud-ownership:provider-unresolved\] table "contacts" points at providerEntrypoint "src\/server\/ContactsProvider\.js" but doctor could not resolve an ownershipFilter from that provider/
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
    await declareInstalledPackages(appRoot, ["@local/products"]);
    await writePackageMetadata(
      appRoot,
      "products",
      `({
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
})
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

test("doctor rejects a generated CRUD table with a composite primary key", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-crud-composite-primary-key-app");
    await createMinimalApp(appRoot);
    await installFakeKnex(appRoot, {
      tables: ["items"],
      columns: {
        items: ["workspace_id", "id"]
      },
      primaryKeys: {
        items: ["workspace_id", "id"]
      }
    });
    await writeKnexfile(appRoot);
    await declareInstalledPackages(appRoot, ["@local/items"]);
    await writeGeneratedCrudPackage(appRoot, {
      ownershipFilter: "workspace"
    });

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.match(
      payload.issues.join("\n"),
      /\[crud-schema:primary-key\] generated CRUD table "items" must have exactly one primary-key column "id"; live primary key is workspace_id, id/
    );
  });
});

test("doctor rejects a generated CRUD foreign key to a non-primary business key", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-crud-business-key-relationship-app");
    await createMinimalApp(appRoot);
    await installFakeKnex(appRoot, {
      tables: ["parents", "items"],
      columns: {
        parents: ["id", "slug"],
        items: ["id", "parent_slug"]
      },
      foreignKeys: [
        {
          tableName: "items",
          constraintName: "items_parent_slug_foreign",
          columnName: "parent_slug",
          referencedTableName: "parents",
          referencedColumnName: "slug"
        }
      ]
    });
    await writeKnexfile(appRoot);
    await declareInstalledPackages(appRoot, ["@local/items"]);
    await writeGeneratedCrudPackage(appRoot);
    await writeAppFile(
      appRoot,
      ".jskit/table-ownership.json",
      `${JSON.stringify(
        {
          version: 1,
          exceptions: [
            {
              tableName: "parents",
              category: "external-source",
              owner: "external-parent-source",
              reason: "Fixture target for relationship validation."
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
      /\[crud-schema:foreign-key-target\].*"items_parent_slug_foreign" targets "parents.slug".*single-column primary key \(live primary key: id\)/
    );
  });
});

test("doctor rejects a composite foreign key on a generated CRUD table", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-crud-composite-relationship-app");
    await createMinimalApp(appRoot);
    await installFakeKnex(appRoot, {
      tables: ["parents", "items"],
      columns: {
        parents: ["id", "workspace_id"],
        items: ["id", "workspace_id", "parent_id"]
      },
      foreignKeys: [
        {
          tableName: "items",
          constraintName: "items_parent_foreign",
          columnName: "workspace_id",
          referencedTableName: "parents",
          referencedColumnName: "workspace_id",
          ordinalPosition: 1
        },
        {
          tableName: "items",
          constraintName: "items_parent_foreign",
          columnName: "parent_id",
          referencedTableName: "parents",
          referencedColumnName: "id",
          ordinalPosition: 2
        }
      ]
    });
    await writeKnexfile(appRoot);
    await declareInstalledPackages(appRoot, ["@local/items"]);
    await writeGeneratedCrudPackage(appRoot, {
      ownershipFilter: "workspace"
    });
    await writeAppFile(
      appRoot,
      ".jskit/table-ownership.json",
      `${JSON.stringify(
        {
          version: 1,
          exceptions: [
            {
              tableName: "parents",
              category: "external-source",
              owner: "external-parent-source",
              reason: "Fixture target for relationship validation."
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
      /\[crud-schema:composite-foreign-key\].*"items_parent_foreign" has 2 columns/
    );
  });
});
