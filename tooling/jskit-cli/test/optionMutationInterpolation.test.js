import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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

test("add package applies option interpolation and conditional file mutations", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "option-mutations-app");
    await createMinimalApp(appRoot, { name: "option-mutations-app" });

    const packageRoot = path.join(appRoot, "packages", "option-feature");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
    await mkdir(path.join(packageRoot, "templates"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/option-feature",
          version: "0.1.0",
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "Provider.js"),
      "class Provider { static id = \"demo.option\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "templates", "workspace.txt"),
      "workspace namespace=${option:namespace|kebab} visibility=${option:visibility} entity=${option:namespace|singular|pascal|default(Record)}\n",
      "utf8"
    );
    await writeFile(
      path.join(packageRoot, "templates", "public.txt"),
      "public namespace=${option:namespace|kebab} visibility=${option:visibility} entity=${option:namespace|singular|pascal|default(Record)} plural=${option:namespace|plural}\n",
      "utf8"
    );
    await writeFile(
      path.join(packageRoot, "templates", "migration.cjs"),
      "module.exports = \"${option:visibility}\";\n",
      "utf8"
    );
    await writeFile(
      path.join(packageRoot, "templates", "prefixed.txt"),
      "prefixed namespace=${option:namespace|kebab} prefix=${option:directory-prefix|path}\n",
      "utf8"
    );
    await writeFile(
      path.join(packageRoot, "templates", "dynamic-route.txt"),
      "route=${option:route-path|path}\n",
      "utf8"
    );
    await writeFile(
      path.join(packageRoot, "templates", "root-only.txt"),
      "root-route-only=true\n",
      "utf8"
    );
    await writeFile(
      path.join(packageRoot, "templates", "all-conditions.txt"),
      "all-conditions=true\n",
      "utf8"
    );
    await writeFile(
      path.join(packageRoot, "templates", "any-conditions.txt"),
      "any-conditions=true\n",
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/option-feature",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  options: {
    namespace: {
      required: false,
      defaultValue: ""
    },
    "directory-prefix": {
      required: false,
      defaultValue: ""
    },
    "route-path": {
      required: false,
      defaultValue: ""
    },
    visibility: {
      required: true,
      defaultValue: "workspace"
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@demo/generated-\${option:namespace|kebab|default(default)}": "1.2.3"
      },
      dev: {}
    },
    files: [
      {
        from: "templates/workspace.txt",
        to: "src/generated/\${option:namespace|kebab|default(default)}/workspace.txt",
        when: {
          option: "visibility",
          in: ["workspaces"]
        }
      },
      {
        from: "templates/public.txt",
        to: "src/generated/\${option:namespace|kebab|default(default)}/public.txt",
        when: {
          option: "visibility",
          in: ["public"]
        }
      },
      {
        from: "templates/prefixed.txt",
        to: "src/generated/\${option:directory-prefix|pathprefix}\${option:namespace|kebab|default(default)}/prefixed.txt"
      },
      {
        from: "templates/dynamic-route.txt",
        to: "src/generated/\${option:route-path|path}/route.txt"
      },
      {
        from: "templates/root-only.txt",
        to: "src/generated/root-only.txt",
        when: {
          all: [
            {
              option: "visibility",
              in: ["public"]
            },
            {
              option: "route-path",
              notContains: "["
            }
          ]
        }
      },
      {
        from: "templates/all-conditions.txt",
        to: "src/generated/all-conditions.txt",
        when: {
          all: [
            {
              option: "visibility",
              in: ["public"]
            },
            {
              option: "route-path",
              contains: "[contactId]"
            }
          ]
        }
      },
      {
        from: "templates/any-conditions.txt",
        to: "src/generated/any-conditions.txt",
        when: {
          any: [
            {
              option: "visibility",
              in: ["workspaces"]
            },
            {
              option: "route-path",
              contains: "[contactId]"
            }
          ]
        }
      },
      {
        op: "install-migration",
        from: "templates/migration.cjs",
        toDir: "migrations",
        id: "demo-\${option:namespace|kebab|default(default)}"
      }
    ]
  }
});\n`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: [
        "add",
        "package",
        "@demo/option-feature",
        "--namespace",
        "client-profiles",
        "--directory-prefix",
        "crm/team alpha",
        "--route-path",
        "contacts/[contactId]/addresses",
        "--visibility",
        "public"
      ]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const publicFile = path.join(appRoot, "src", "generated", "client-profiles", "public.txt");
    const publicContent = await readFile(publicFile, "utf8");
    assert.equal(publicContent, "public namespace=client-profiles visibility=public entity=ClientProfile plural=client-profiles\n");

    const workspaceFile = path.join(appRoot, "src", "generated", "client-profiles", "workspace.txt");
    await assert.rejects(() => readFile(workspaceFile, "utf8"));

    const prefixedFile = path.join(appRoot, "src", "generated", "crm", "team-alpha", "client-profiles", "prefixed.txt");
    const prefixedContent = await readFile(prefixedFile, "utf8");
    assert.equal(prefixedContent, "prefixed namespace=client-profiles prefix=crm/team-alpha\n");
    const dynamicRouteFile = path.join(
      appRoot,
      "src",
      "generated",
      "contacts",
      "[contactId]",
      "addresses",
      "route.txt"
    );
    const dynamicRouteContent = await readFile(dynamicRouteFile, "utf8");
    assert.equal(dynamicRouteContent, "route=contacts/[contactId]/addresses\n");
    const rootOnlyFile = path.join(appRoot, "src", "generated", "root-only.txt");
    await assert.rejects(() => readFile(rootOnlyFile, "utf8"));
    const allConditionsFile = path.join(appRoot, "src", "generated", "all-conditions.txt");
    const allConditionsContent = await readFile(allConditionsFile, "utf8");
    assert.equal(allConditionsContent, "all-conditions=true\n");
    const anyConditionsFile = path.join(appRoot, "src", "generated", "any-conditions.txt");
    const anyConditionsContent = await readFile(anyConditionsFile, "utf8");
    assert.equal(anyConditionsContent, "any-conditions=true\n");

    const migrationsDirectory = path.join(appRoot, "migrations");
    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((entry) => /^\d{14}_demo-client-profiles\.cjs$/.test(entry))
      .sort();
    assert.equal(migrationFiles.length, 1);
    const migrationPath = path.join(migrationsDirectory, migrationFiles[0]);
    const migrationContent = await readFile(migrationPath, "utf8");
    assert.match(migrationContent, /module\.exports = "public";/);

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "package", "@demo/option-feature"]
    });
    assert.equal(updateResult.status, 0, String(updateResult.stderr || ""));

    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    const installedPackage = lock?.installedPackages?.["@demo/option-feature"];
    const managedMigrations = Array.isArray(installedPackage?.managed?.migrations)
      ? installedPackage.managed.migrations
      : [];
    assert.equal(managedMigrations.length, 1);
    assert.equal(managedMigrations[0].id, "demo-client-profiles");
    assert.match(String(managedMigrations[0].path || ""), /^migrations\/\d{14}_demo-client-profiles\.cjs$/);
    assert.match(String(managedMigrations[0].hash || ""), /^[a-f0-9]{64}$/);

    const appPackageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(appPackageJson.dependencies["@demo/generated-client-profiles"], "1.2.3");
  });
});

test("update package fails when an install-migration source changes for the same id", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "migration-immutability-app");
    await createMinimalApp(appRoot, { name: "migration-immutability-app" });

    const packageRoot = path.join(appRoot, "packages", "migration-feature");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
    await mkdir(path.join(packageRoot, "templates"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/migration-feature",
          version: "0.1.0",
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "Provider.js"),
      "class Provider { static id = \"demo.migration\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "templates", "migration.cjs"),
      "module.exports = \"v1\";\n",
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/migration-feature",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        op: "install-migration",
        from: "templates/migration.cjs",
        toDir: "migrations",
        extension: ".cjs",
        id: "demo-migration-immutability"
      }
    ]
  }
});\n`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/migration-feature"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    await writeFile(
      path.join(packageRoot, "templates", "migration.cjs"),
      "module.exports = \"v2\";\n",
      "utf8"
    );

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "package", "@demo/migration-feature"]
    });
    assert.equal(updateResult.status, 1);
    assert.match(String(updateResult.stderr || ""), /migration demo-migration-immutability changed after install/i);
  });
});

test("add package allows empty rendered install-migration files", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "empty-migration-app");
    await createMinimalApp(appRoot, { name: "empty-migration-app" });

    const packageRoot = path.join(appRoot, "packages", "empty-migration");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
    await mkdir(path.join(packageRoot, "templates"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/empty-migration",
          version: "0.1.0",
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "Provider.js"),
      "class Provider { static id = \"demo.empty.migration\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );
    await writeFile(path.join(packageRoot, "templates", "migration.cjs"), "", "utf8");

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/empty-migration",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        op: "install-migration",
        from: "templates/migration.cjs",
        toDir: "migrations",
        extension: ".cjs",
        id: "demo-empty-migration"
      }
    ]
  }
});\n`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/empty-migration"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const migrationFiles = (await readdir(path.join(appRoot, "migrations")))
      .filter((entry) => /^\d{14}_demo-empty-migration\.cjs$/.test(entry))
      .sort();
    assert.equal(migrationFiles.length, 1);
    assert.equal(await readFile(path.join(appRoot, "migrations", migrationFiles[0]), "utf8"), "");
  });
});

test("remove then re-add package reuses existing timestamped migration by id", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "migration-readd-app");
    await createMinimalApp(appRoot, { name: "migration-readd-app" });

    const packageRoot = path.join(appRoot, "packages", "migration-readd");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
    await mkdir(path.join(packageRoot, "templates"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/migration-readd",
          version: "0.1.0",
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "Provider.js"),
      "class Provider { static id = \"demo.migration.readd\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );
    await writeFile(path.join(packageRoot, "templates", "migration.cjs"), "module.exports = \"v1\";\n", "utf8");

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/migration-readd",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        op: "install-migration",
        from: "templates/migration.cjs",
        toDir: "migrations",
        extension: ".cjs",
        id: "demo-migration-readd"
      }
    ]
  }
});\n`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/migration-readd"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const lockPath = path.join(appRoot, ".jskit", "lock.json");
    const lockAfterFirstAdd = JSON.parse(await readFile(lockPath, "utf8"));
    const firstMigrationPath =
      lockAfterFirstAdd?.installedPackages?.["@demo/migration-readd"]?.managed?.migrations?.[0]?.path || "";
    assert.match(String(firstMigrationPath), /^migrations\/\d{14}_demo-migration-readd\.cjs$/);

    const removeResult = runCli({
      cwd: appRoot,
      args: ["remove", "package", "@demo/migration-readd"]
    });
    assert.equal(removeResult.status, 0, String(removeResult.stderr || ""));

    const readdResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/migration-readd"]
    });
    assert.equal(readdResult.status, 0, String(readdResult.stderr || ""));

    const lockAfterReadd = JSON.parse(await readFile(lockPath, "utf8"));
    const managedMigrations = Array.isArray(
      lockAfterReadd?.installedPackages?.["@demo/migration-readd"]?.managed?.migrations
    )
      ? lockAfterReadd.installedPackages["@demo/migration-readd"].managed.migrations
      : [];
    assert.equal(managedMigrations.length, 1);
    assert.equal(managedMigrations[0].id, "demo-migration-readd");
    assert.equal(managedMigrations[0].path, firstMigrationPath);
    assert.equal(managedMigrations[0].skipped, true);

    const migrationFiles = (await readdir(path.join(appRoot, "migrations")))
      .filter((entry) => /_demo-migration-readd\.cjs$/.test(entry))
      .sort();
    assert.equal(migrationFiles.length, 1);
  });
});

test("add package fails when install-migration is missing id", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "migration-id-required-app");
    await createMinimalApp(appRoot, { name: "migration-id-required-app" });

    const packageRoot = path.join(appRoot, "packages", "migration-id-required");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
    await mkdir(path.join(packageRoot, "templates"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/migration-id-required",
          version: "0.1.0",
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "Provider.js"),
      "class Provider { static id = \"demo.migration.required\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );
    await writeFile(path.join(packageRoot, "templates", "migration.cjs"), "module.exports = \"ok\";\n", "utf8");

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/migration-id-required",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        op: "install-migration",
        from: "templates/migration.cjs",
        toDir: "migrations"
      }
    ]
  }
});\n`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/migration-id-required"]
    });
    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /install-migration.*requires "id"/i);
  });
});

test("add package fails when install-migration id is not lowercase-safe", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "migration-id-case-app");
    await createMinimalApp(appRoot, { name: "migration-id-case-app" });

    const packageRoot = path.join(appRoot, "packages", "migration-id-case");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
    await mkdir(path.join(packageRoot, "templates"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/migration-id-case",
          version: "0.1.0",
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "Provider.js"),
      "class Provider { static id = \"demo.migration.case\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );
    await writeFile(path.join(packageRoot, "templates", "migration.cjs"), "module.exports = \"ok\";\n", "utf8");

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/migration-id-case",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        op: "install-migration",
        from: "templates/migration.cjs",
        toDir: "migrations",
        id: "Demo-Migration"
      }
    ]
  }
});\n`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/migration-id-case"]
    });
    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /install-migration mutation.*id.*must match/i);
  });
});

test("update package rejects managed migration paths outside app root", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "migration-path-hardening-app");
    await createMinimalApp(appRoot, { name: "migration-path-hardening-app" });

    const packageRoot = path.join(appRoot, "packages", "migration-path-hardening");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
    await mkdir(path.join(packageRoot, "templates"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/migration-path-hardening",
          version: "0.1.0",
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "Provider.js"),
      "class Provider { static id = \"demo.migration.path\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );
    await writeFile(path.join(packageRoot, "templates", "migration.cjs"), "module.exports = \"ok\";\n", "utf8");

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/migration-path-hardening",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        op: "install-migration",
        from: "templates/migration.cjs",
        toDir: "migrations",
        id: "demo-migration-path-hardening"
      }
    ]
  }
});\n`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/migration-path-hardening"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const lockPath = path.join(appRoot, ".jskit", "lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.installedPackages["@demo/migration-path-hardening"].managed.migrations[0].path = "../outside.cjs";
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "package", "@demo/migration-path-hardening"]
    });
    assert.equal(updateResult.status, 1);
    assert.match(
      String(updateResult.stderr || ""),
      /managed migration path.*(safe relative path|stay within app root)/i
    );
  });
});

test("add package evaluates when.config conditions from app config", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "config-mutations-app");
    await createMinimalApp(appRoot, { name: "config-mutations-app" });

    await mkdir(path.join(appRoot, "config"), { recursive: true });
    await writeFile(
      path.join(appRoot, "config", "public.js"),
      "export const config = { tenancyMode: \"workspaces\" };\n",
      "utf8"
    );

    const packageRoot = path.join(appRoot, "packages", "config-feature");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
    await mkdir(path.join(packageRoot, "templates"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/config-feature",
          version: "0.1.0",
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "Provider.js"),
      "class Provider { static id = \"demo.config\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );

    await writeFile(path.join(packageRoot, "templates", "workspace.txt"), "workspace\n", "utf8");
    await writeFile(path.join(packageRoot, "templates", "none.txt"), "none\n", "utf8");

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/config-feature",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        from: "templates/workspace.txt",
        to: "src/generated/workspace.txt",
        when: {
          config: "tenancyMode",
          in: ["workspaces"]
        }
      },
      {
        from: "templates/none.txt",
        to: "src/generated/none.txt",
        when: {
          config: "tenancyMode",
          in: ["none"]
        }
      }
    ]
  }
});\n`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/config-feature"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const workspaceFile = path.join(appRoot, "src", "generated", "workspace.txt");
    const workspaceContent = await readFile(workspaceFile, "utf8");
    assert.equal(workspaceContent, "workspace\n");

    const noneFile = path.join(appRoot, "src", "generated", "none.txt");
    await assert.rejects(() => readFile(noneFile, "utf8"));
  });
});

test("add package resolves option defaultFromConfig from app config", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "default-from-config-app");
    await createMinimalApp(appRoot, { name: "default-from-config-app" });

    await mkdir(path.join(appRoot, "config"), { recursive: true });
    await writeFile(
      path.join(appRoot, "config", "public.js"),
      [
        "export const config = {};",
        'config.surfaceDefaultId = "console";',
        ""
      ].join("\n"),
      "utf8"
    );

    const packageRoot = path.join(appRoot, "packages", "default-from-config-feature");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
    await mkdir(path.join(packageRoot, "templates"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/default-from-config-feature",
          version: "0.1.0",
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "Provider.js"),
      "class Provider { static id = \"demo.defaultFromConfig\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );
    await writeFile(
      path.join(packageRoot, "templates", "resolved-surface.txt"),
      "surface=${option:surface|lower}\n",
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/default-from-config-feature",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  options: {
    surface: {
      required: true,
      defaultFromConfig: "surfaceDefaultId"
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        from: "templates/resolved-surface.txt",
        to: "src/generated/surface.txt"
      }
    ]
  }
});\n`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/default-from-config-feature"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const generatedSurfaceFile = await readFile(path.join(appRoot, "src", "generated", "surface.txt"), "utf8");
    assert.equal(generatedSurfaceFile, "surface=console\n");
  });
});
