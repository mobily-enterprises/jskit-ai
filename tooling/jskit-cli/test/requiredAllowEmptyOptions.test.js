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

async function createMinimalPackage({ appRoot, packageId, optionsSource }) {
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
    "class Provider { static id = \"demo.options\"; register() {} boot() {} }\nexport { Provider };\n",
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
  options: ${optionsSource},
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    text: [
      {
        file: ".env",
        op: "upsert-env",
        key: "REDIS_URL",
        value: "\${option:redis-url}"
      }
    ]
  }
});\n`,
    "utf8"
  );
}

test("add package accepts explicit empty value for required allowEmpty option", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "allow-empty-required");
    await createMinimalApp(appRoot, { name: "allow-empty-required" });
    await createMinimalPackage({
      appRoot,
      packageId: "@demo/allow-empty-required",
      optionsSource: `{
    "redis-url": {
      required: true,
      allowEmpty: true,
      defaultValue: ""
    }
  }`
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/allow-empty-required", "--redis-url="]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const envSource = await readFile(path.join(appRoot, ".env"), "utf8");
    assert.match(envSource, /^REDIS_URL=$/m);
  });
});

test("add package accepts shell-style empty-string token for required allowEmpty option", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "allow-empty-required-token");
    await createMinimalApp(appRoot, { name: "allow-empty-required-token" });
    await createMinimalPackage({
      appRoot,
      packageId: "@demo/allow-empty-required-token",
      optionsSource: `{
    "redis-url": {
      required: true,
      allowEmpty: true,
      defaultValue: ""
    }
  }`
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/allow-empty-required-token", "--redis-url", ""]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const envSource = await readFile(path.join(appRoot, ".env"), "utf8");
    assert.match(envSource, /^REDIS_URL=$/m);
  });
});

test("add package interpolates upsert-env keys before writing .env", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "interpolated-upsert-env-key");
    await createMinimalApp(appRoot, { name: "interpolated-upsert-env-key" });
    await createMinimalPackage({
      appRoot,
      packageId: "@demo/interpolated-upsert-env-key",
      optionsSource: `{
    "env-prefix": {
      required: true,
      defaultValue: "HOME_ASSISTANT"
    },
    "redis-url": {
      required: true,
      allowEmpty: true,
      defaultValue: ""
    }
  }`
    });

    const descriptorPath = path.join(appRoot, 'packages', 'interpolated-upsert-env-key', 'package.descriptor.mjs');
    const descriptorSource = await readFile(descriptorPath, 'utf8');
    await writeFile(
      descriptorPath,
      descriptorSource.replace('key: "REDIS_URL"', 'key: "${option:env-prefix}_REDIS_URL"'),
      'utf8'
    );

    const addResult = runCli({
      cwd: appRoot,
      args: [
        'add',
        'package',
        '@demo/interpolated-upsert-env-key',
        '--env-prefix',
        'HOME_ASSISTANT',
        '--redis-url',
        ''
      ]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ''));

    const envSource = await readFile(path.join(appRoot, '.env'), 'utf8');
    assert.match(envSource, /^HOME_ASSISTANT_REDIS_URL=$/m);
    assert.doesNotMatch(envSource, /\$\{option:env-prefix\}_REDIS_URL=/);
  });
});

test("add package rejects explicit empty value for required non-empty option", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "required-non-empty");
    await createMinimalApp(appRoot, { name: "required-non-empty" });
    await createMinimalPackage({
      appRoot,
      packageId: "@demo/required-non-empty",
      optionsSource: `{
    "redis-url": {
      required: true,
      defaultValue: ""
    }
  }`
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/required-non-empty", "--redis-url="]
    });
    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /requires a non-empty value/i);
  });
});
