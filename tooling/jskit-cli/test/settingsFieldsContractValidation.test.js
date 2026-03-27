import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

async function createConsoleSettingsMutationPackage(appRoot, { packageId = "@demo/settings-appender" } = {}) {
  const packageName = packageId.slice(packageId.indexOf("/") + 1);
  const packageRoot = path.join(appRoot, "packages", packageName);
  await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });

  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: packageId,
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
    "class Provider { static id = \"demo.settings-appender\"; register() {} boot() {} }\nexport { Provider };\n",
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageId: "${packageId}",
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
    text: [
      {
        op: "append-text",
        file: "packages/main/src/shared/resources/consoleSettingsFields.js",
        position: "bottom",
        skipIfContains: "demoSettingsFieldMarker",
        value: "\\n// demoSettingsFieldMarker\\n"
      }
    ]
  }
});\n`,
    "utf8"
  );
}

async function writeConsoleSettingsContractFile(appRoot, { withMarker = true } = {}) {
  const targetFile = path.join(appRoot, "packages", "main", "src", "shared", "resources", "consoleSettingsFields.js");
  await mkdir(path.dirname(targetFile), { recursive: true });
  await writeFile(
    targetFile,
    [
      ...(withMarker ? ["// @jskit-contract users.settings-fields.console.v1"] : []),
      "import {",
      "  defineField,",
      "  resetConsoleSettingsFields",
      "} from \"@jskit-ai/users-core/shared/resources/consoleSettingsFields\";",
      "",
      "resetConsoleSettingsFields();",
      "",
      "void defineField;",
      ""
    ].join("\n"),
    "utf8"
  );
}

test("add package fails when console settings fields contract marker is missing", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "settings-fields-contract-missing-marker");
    await createMinimalApp(appRoot, { name: "settings-fields-contract-missing-marker" });
    await createConsoleSettingsMutationPackage(appRoot);
    await writeConsoleSettingsContractFile(appRoot, { withMarker: false });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/settings-appender", "--no-install"]
    });

    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /missing contract marker/i);
  });
});

test("add package passes when console settings fields contract marker is present", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "settings-fields-contract-valid");
    await createMinimalApp(appRoot, { name: "settings-fields-contract-valid" });
    await createConsoleSettingsMutationPackage(appRoot);
    await writeConsoleSettingsContractFile(appRoot, { withMarker: true });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/settings-appender", "--no-install"]
    });

    assert.equal(addResult.status, 0, String(addResult.stderr || ""));
    const targetSource = await readFile(
      path.join(appRoot, "packages", "main", "src", "shared", "resources", "consoleSettingsFields.js"),
      "utf8"
    );
    assert.match(targetSource, /demoSettingsFieldMarker/);
  });
});
