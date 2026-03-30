import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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

test("add package fails on unknown inline option for target package", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "inline-options-app");
    await createMinimalApp(appRoot, { name: "inline-options-app" });

    const packageRoot = path.join(appRoot, "packages", "no-options");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/no-options",
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
      "class Provider { static id = \"demo.no-options\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/no-options",
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
  options: {},
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    }
  }
});\n`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/no-options", "--namespace", "dragons"]
    });

    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /Unknown option\(s\) for package @demo\/no-options: namespace\./);
    assert.match(String(addResult.stderr || ""), /does not accept inline options/i);
  });
});
