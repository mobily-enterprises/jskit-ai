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
      "// JSKIT_MIGRATION_ID: demo_${option:namespace|snake|default(default)}\nmodule.exports = \"${option:visibility}\";\n",
      "utf8"
    );
    await writeFile(
      path.join(packageRoot, "templates", "prefixed.txt"),
      "prefixed namespace=${option:namespace|kebab} prefix=${option:directory-prefix|path}\n",
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/option-feature",
  version: "0.1.0",
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
          in: ["workspace"]
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
        op: "install-migration",
        from: "templates/migration.cjs",
        toDir: "migrations",
        slug: "demo_\${option:namespace|snake|default(default)}",
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
        "--visibility",
        "public",
        "--no-install"
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

    const migrationDirectory = path.join(appRoot, "migrations");
    const migrationFiles = await readdir(migrationDirectory);
    assert.equal(migrationFiles.length, 1);
    assert.match(migrationFiles[0], /_demo_client_profiles\.cjs$/);

    const migrationContent = await readFile(path.join(migrationDirectory, migrationFiles[0]), "utf8");
    assert.match(migrationContent, /JSKIT_MIGRATION_ID: demo_client_profiles/);
    assert.match(migrationContent, /module\.exports = "public";/);

    const appPackageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(appPackageJson.dependencies["@demo/generated-client-profiles"], "1.2.3");
  });
});
