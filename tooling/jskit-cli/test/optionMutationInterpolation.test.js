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
      "workspace namespace=${option:namespace} visibility=${option:visibility}\n",
      "utf8"
    );
    await writeFile(
      path.join(packageRoot, "templates", "public.txt"),
      "public namespace=${option:namespace} visibility=${option:visibility}\n",
      "utf8"
    );
    await writeFile(
      path.join(packageRoot, "templates", "migration.cjs"),
      "// JSKIT_MIGRATION_ID: demo_${option:namespace}\nmodule.exports = \"${option:visibility}\";\n",
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
    visibility: {
      required: true,
      defaultValue: "workspace"
    }
  },
  mutations: {
    files: [
      {
        from: "templates/workspace.txt",
        to: "src/generated/\${option:namespace}/workspace.txt",
        when: {
          option: "visibility",
          in: ["workspace"]
        }
      },
      {
        from: "templates/public.txt",
        to: "src/generated/\${option:namespace}/public.txt",
        when: {
          option: "visibility",
          in: ["public"]
        }
      },
      {
        op: "install-migration",
        from: "templates/migration.cjs",
        toDir: "migrations",
        slug: "demo_\${option:namespace}",
        id: "demo-\${option:namespace}"
      }
    ]
  }
});\n`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/option-feature", "--namespace", "crm", "--visibility", "public", "--no-install"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const publicFile = path.join(appRoot, "src", "generated", "crm", "public.txt");
    const publicContent = await readFile(publicFile, "utf8");
    assert.equal(publicContent, "public namespace=crm visibility=public\n");

    const workspaceFile = path.join(appRoot, "src", "generated", "crm", "workspace.txt");
    await assert.rejects(() => readFile(workspaceFile, "utf8"));

    const migrationDirectory = path.join(appRoot, "migrations");
    const migrationFiles = await readdir(migrationDirectory);
    assert.equal(migrationFiles.length, 1);
    assert.match(migrationFiles[0], /_demo_crm\.cjs$/);

    const migrationContent = await readFile(path.join(migrationDirectory, migrationFiles[0]), "utf8");
    assert.match(migrationContent, /JSKIT_MIGRATION_ID: demo_crm/);
    assert.match(migrationContent, /module\.exports = "public";/);
  });
});
