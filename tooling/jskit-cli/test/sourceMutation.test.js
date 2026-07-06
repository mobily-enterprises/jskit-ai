import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createMinimalApp(appRoot, { name = "source-mutation-app" } = {}) {
  await writeJson(path.join(appRoot, "package.json"), {
    name,
    version: "0.1.0",
    private: true,
    type: "module"
  });
  await mkdir(path.join(appRoot, "packages", "main", "src", "client", "providers"), { recursive: true });
  await writeFile(
    path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js"),
    `const mainClientComponents = [];

function registerMainClientComponent(token, resolveComponent) {
  mainClientComponents.push({ token, resolveComponent });
}

class MainClientProvider {
  static id = "local.main.client";
}

export {
  MainClientProvider,
  registerMainClientComponent
};
`,
    "utf8"
  );
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await writeFile(
    path.join(appRoot, "config", "public.js"),
    `const config = {};

export default config;
`,
    "utf8"
  );
}

async function writeLocalSourcePackageDescriptor(appRoot) {
  const packageRoot = path.join(appRoot, "packages", "source-feature");
  await writeJson(path.join(packageRoot, "package.json"), {
    name: "@demo/source-feature",
    version: "0.1.0",
    type: "module"
  });

  const sourceMutations = [
    {
      op: "ensure-import",
      file: "packages/main/src/client/providers/MainClientProvider.js",
      defaultImport: "DemoWidget",
      from: "/src/components/DemoWidget.vue",
      id: "demo-widget-import",
      reason: "Bind demo widget import."
    },
    {
      op: "ensure-call",
      file: "packages/main/src/client/providers/MainClientProvider.js",
      callee: "registerMainClientComponent",
      args: ["\"demo.widget\"", "() => DemoWidget"],
      beforeClass: "MainClientProvider",
      id: "demo-widget-register",
      reason: "Bind demo widget component token."
    },
    {
      op: "ensure-assignment",
      file: "config/public.js",
      target: "config.surfaceDefinitions.demo",
      value: "{ id: \"demo\", label: \"Demo\" }",
      ensureObjects: ["config.surfaceDefinitions"],
      id: "demo-surface-definition",
      reason: "Bind demo surface definition."
    },
    {
      op: "ensure-export-const",
      file: "config/surfaceAccessPolicies.js",
      name: "surfaceAccessPolicies",
      value: "{}",
      id: "demo-surface-access-policies",
      reason: "Ensure policy export exists."
    }
  ];

  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageVersion: 1,
  packageId: "@demo/source-feature",
  version: "0.1.0",
  kind: "runtime",
  description: "Local package for source mutation coverage.",
  dependsOn: [],
  capabilities: {
    provides: [],
    requires: []
  },
  runtime: {
    server: {
      providers: []
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
    packageJson: {
      scripts: {}
    },
    text: [],
    source: ${JSON.stringify(sourceMutations, null, 4)},
    files: []
  }
});
`,
    "utf8"
  );
}

function countOccurrences(source, pattern) {
  return (source.match(pattern) || []).length;
}

test("add package applies source mutations and update package keeps them idempotent", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "source-mutation-app");
    await createMinimalApp(appRoot);
    await writeLocalSourcePackageDescriptor(appRoot);

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/source-feature"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "package", "@demo/source-feature"]
    });
    assert.equal(updateResult.status, 0, String(updateResult.stderr || ""));

    const providerSource = await readFile(
      path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js"),
      "utf8"
    );
    assert.equal(countOccurrences(providerSource, /import DemoWidget from "\/src\/components\/DemoWidget\.vue";/g), 1);
    assert.equal(countOccurrences(providerSource, /registerMainClientComponent\("demo\.widget", \(\) => DemoWidget\);/g), 1);
    assert.ok(
      providerSource.indexOf("registerMainClientComponent(\"demo.widget\", () => DemoWidget);") <
        providerSource.indexOf("class MainClientProvider")
    );

    const publicConfigSource = await readFile(path.join(appRoot, "config", "public.js"), "utf8");
    assert.equal(countOccurrences(publicConfigSource, /config\.surfaceDefinitions \|\|= \{\};/g), 1);
    assert.equal(countOccurrences(publicConfigSource, /config\.surfaceDefinitions\.demo = \{ id: "demo", label: "Demo" \};/g), 1);

    const accessPolicySource = await readFile(path.join(appRoot, "config", "surfaceAccessPolicies.js"), "utf8");
    assert.equal(countOccurrences(accessPolicySource, /export const surfaceAccessPolicies = \{\};/g), 1);

    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    assert.equal(
      lock?.installedPackages?.["@demo/source-feature"]?.managed?.source?.[
        "packages/main/src/client/providers/MainClientProvider.js::demo-widget-register"
      ]?.op,
      "ensure-call"
    );

    const showResult = runCli({
      cwd: appRoot,
      args: ["show", "@demo/source-feature"]
    });
    assert.equal(showResult.status, 0, String(showResult.stderr || ""));
    const stdout = stripVTControlCharacters(String(showResult.stdout || ""));
    assert.match(stdout, /Source mutations \(4\):/);
    assert.match(stdout, /ensure-call packages\/main\/src\/client\/providers\/MainClientProvider\.js registerMainClientComponent/);
  });
});
