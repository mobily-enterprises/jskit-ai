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
  await mkdir(path.join(appRoot, "src", "pages"), { recursive: true });
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

async function writeGeneratorPackage(appRoot, packageName, descriptorSource) {
  const packageRoot = path.join(appRoot, "packages", packageName);
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: `@jskit-ai/${packageName}`,
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(path.join(packageRoot, "package.descriptor.mjs"), descriptorSource, "utf8");
}

test("completion bash prints an installable bash completion script", () => {
  const result = runCli({ args: ["completion", "bash"] });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /_jskit_completion\(\)/);
  assert.match(stdout, /compgen -W "jskit"/);
  assert.match(stdout, /npx jskit completion bash __complete__/);
  assert.match(stdout, /complete -o bashdefault -o default -F _jskit_completion npx/);
  assert.match(stdout, /complete -o bashdefault -o default -F _jskit_completion jskit/);
});

test("completion bash __complete__ lists only canonical top-level commands", () => {
  const result = runCli({
    args: ["completion", "bash", "__complete__", "2", "--", "npx", "jskit", ""]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const completions = String(result.stdout || "").trim().split(/\r?\n/u).filter(Boolean);
  assert.ok(completions.includes("app"));
  assert.ok(completions.includes("generate"));
  assert.ok(completions.includes("list"));
  assert.ok(completions.includes("list-component-tokens"));
  assert.ok(completions.includes("show"));
  assert.ok(!completions.includes("gen"));
  assert.ok(!completions.includes("ls"));
  assert.ok(!completions.includes("lp"));
  assert.ok(!completions.includes("lct"));
  assert.ok(!completions.includes("lpct"));
  assert.ok(!completions.includes("list-link-items"));
  assert.ok(!completions.includes("list-placement-component-tokens"));
  assert.ok(!completions.includes("view"));
});

test("completion bash __complete__ lists app subcommands and app-specific options", () => {
  const subcommandResult = runCli({
    args: ["completion", "bash", "__complete__", "3", "--", "npx", "jskit", "app", ""]
  });

  assert.equal(subcommandResult.status, 0, String(subcommandResult.stderr || ""));
  assert.deepEqual(
    String(subcommandResult.stdout || "").trim().split(/\r?\n/u).filter(Boolean),
    ["adopt-managed-scripts", "link-local-packages", "release", "update-packages", "verify", "verify-ui"]
  );

  const optionResult = runCli({
    args: ["completion", "bash", "__complete__", "4", "--", "npx", "jskit", "app", "update-packages", "--"]
  });

  assert.equal(optionResult.status, 0, String(optionResult.stderr || ""));
  assert.deepEqual(
    String(optionResult.stdout || "").trim().split(/\r?\n/u).filter(Boolean),
    ["--dry-run", "--help", "--registry"]
  );

  const releaseOptionResult = runCli({
    args: ["completion", "bash", "__complete__", "4", "--", "npx", "jskit", "app", "release", "--"]
  });

  assert.equal(releaseOptionResult.status, 0, String(releaseOptionResult.stderr || ""));
  assert.deepEqual(
    String(releaseOptionResult.stdout || "").trim().split(/\r?\n/u).filter(Boolean),
    ["--dry-run", "--help", "--registry"]
  );

  const verifyUiOptionResult = runCli({
    args: ["completion", "bash", "__complete__", "4", "--", "npx", "jskit", "app", "verify-ui", "--"]
  });

  assert.equal(verifyUiOptionResult.status, 0, String(verifyUiOptionResult.stderr || ""));
  assert.deepEqual(
    String(verifyUiOptionResult.stdout || "").trim().split(/\r?\n/u).filter(Boolean),
    ["--against", "--auth-mode", "--command", "--feature", "--help"]
  );

  const verifyOptionResult = runCli({
    args: ["completion", "bash", "__complete__", "4", "--", "npx", "jskit", "app", "verify", "--"]
  });

  assert.equal(verifyOptionResult.status, 0, String(verifyOptionResult.stderr || ""));
  assert.deepEqual(
    String(verifyOptionResult.stdout || "").trim().split(/\r?\n/u).filter(Boolean),
    ["--against", "--help"]
  );
});

test("completion bash --install writes a short loader file and updates bashrc", async () => {
  await withTempDir(async (cwd) => {
    const homeRoot = path.join(cwd, "home");
    await mkdir(homeRoot, { recursive: true });

    const result = runCli({
      cwd,
      args: ["completion", "bash", "--install"],
      env: {
        HOME: homeRoot
      }
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const completionFile = path.join(homeRoot, ".jskit", "completion", "bash", "jskit.bash");
    const bashrcFile = path.join(homeRoot, ".bashrc");
    const completionScript = await readFile(completionFile, "utf8");
    const bashrc = await readFile(bashrcFile, "utf8");

    assert.match(completionScript, /_jskit_completion\(\)/);
    assert.match(completionScript, /npx jskit completion bash __complete__/);
    assert.match(bashrc, /# >>> jskit completion >>>/);
    assert.match(bashrc, /\.jskit\/completion\/bash\/jskit\.bash/);
    assert.match(String(result.stdout || ""), /Run: source ~\/\.bashrc/);
  });
});

test("completion bash __complete__ resolves descriptor-backed values from the current app", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "completion-app");
    await createMinimalApp(appRoot, { name: "completion-app" });

    await writeGeneratorPackage(
      appRoot,
      "crud-ui-generator",
      `export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/crud-ui-generator",
  version: "0.1.0",
  kind: "generator",
  options: {
    "resource-file": { inputType: "text" },
    operations: {
      inputType: "text",
      validationType: "csv-enum",
      allowedValues: ["list", "view", "new", "edit"]
    }
  },
  dependsOn: [],
  capabilities: { provides: [], requires: [] },
  runtime: { server: { providers: [] }, client: { providers: [] } },
  metadata: {
    generatorPrimarySubcommand: "crud",
    generatorSubcommands: {
      crud: {
        optionNames: ["resource-file", "operations"],
        requiredOptionNames: ["resource-file"]
      }
    }
  },
  mutations: { dependencies: { runtime: {}, dev: {} }, packageJson: { scripts: {} }, procfile: {}, files: [], text: [] }
});\n`
    );

    await writeGeneratorPackage(
      appRoot,
      "crud-server-generator",
      `export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/crud-server-generator",
  version: "0.1.0",
  kind: "generator",
  options: {
    "ownership-filter": {
      inputType: "text",
      validationType: "enum",
      allowedValues: ["auto", "public", "user", "workspace", "workspace_user"]
    }
  },
  dependsOn: [],
  capabilities: { provides: [], requires: [] },
  runtime: { server: { providers: [] }, client: { providers: [] } },
  metadata: {
    generatorPrimarySubcommand: "scaffold",
    generatorSubcommands: {
      scaffold: {
        optionNames: ["ownership-filter"]
      }
    }
  },
  mutations: { dependencies: { runtime: {}, dev: {} }, packageJson: { scripts: {} }, procfile: {}, files: [], text: [] }
});\n`
    );

    const resourceDir = path.join(appRoot, "packages", "widgets", "src", "shared");
    await mkdir(resourceDir, { recursive: true });
    await writeFile(
      path.join(resourceDir, "widgetResource.js"),
      "export const resource = {};\n",
      "utf8"
    );

    const operationsResult = runCli({
      cwd: appRoot,
      args: [
        "completion",
        "bash",
        "__complete__",
        "6",
        "--",
        "npx",
        "jskit",
        "generate",
        "crud-ui-generator",
        "crud",
        "--operations",
        ""
      ]
    });
    assert.equal(operationsResult.status, 0, String(operationsResult.stderr || ""));
    assert.deepEqual(
      String(operationsResult.stdout || "").trim().split(/\r?\n/u).filter(Boolean),
      ["edit", "list", "new", "view"]
    );

    const resourceFileResult = runCli({
      cwd: appRoot,
      args: [
        "completion",
        "bash",
        "__complete__",
        "6",
        "--",
        "npx",
        "jskit",
        "generate",
        "crud-ui-generator",
        "crud",
        "--resource-file",
        ""
      ]
    });
    assert.equal(resourceFileResult.status, 0, String(resourceFileResult.stderr || ""));
    assert.deepEqual(
      String(resourceFileResult.stdout || "").trim().split(/\r?\n/u).filter(Boolean),
      ["packages/widgets/src/shared/widgetResource.js"]
    );

    const ownershipResult = runCli({
      cwd: appRoot,
      args: [
        "completion",
        "bash",
        "__complete__",
        "6",
        "--",
        "npx",
        "jskit",
        "generate",
        "crud-server-generator",
        "scaffold",
        "--ownership-filter",
        ""
      ]
    });
    assert.equal(ownershipResult.status, 0, String(ownershipResult.stderr || ""));
    assert.deepEqual(
      String(ownershipResult.stdout || "").trim().split(/\r?\n/u).filter(Boolean),
      ["auto", "public", "user", "workspace", "workspace_user"]
    );
  });
});
