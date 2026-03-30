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

async function writeGeneratorPackage(appRoot) {
  const packageRoot = path.join(appRoot, "packages", "demo-generator");
  await mkdir(path.join(packageRoot, "src", "server", "subcommands"), { recursive: true });

  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@demo/generator",
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageVersion: 1,
  packageId: "@demo/generator",
  version: "0.1.0",
  kind: "generator",
  description: "Demo generator",
  options: {},
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
  metadata: {
    generatorSubcommands: {
      ping: {
        entrypoint: "src/server/subcommands/ping.js",
        export: "runGeneratorSubcommand"
      }
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
    procfile: {},
    files: [],
    text: []
  }
});
`,
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "src", "server", "subcommands", "ping.js"),
    `import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

async function runGeneratorSubcommand({ appRoot, subcommand, args = [], dryRun = false } = {}) {
  const relativeFile = "tmp/generator-subcommand.txt";
  const outputPath = path.join(appRoot, relativeFile);
  if (!dryRun) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, String(subcommand || "") + ":" + args.join(","), "utf8");
  }
  return {
    touchedFiles: dryRun ? [] : [relativeFile],
    summary: "ok"
  };
}

export { runGeneratorSubcommand };
`,
    "utf8"
  );
}

test("generate <packageId> <subcommand> runs generator subcommand without install flow", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "generator-subcommand-app");
    await createMinimalApp(appRoot, { name: "generator-subcommand-app" });
    await writeGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "@demo/generator", "ping", "a", "b"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Generated with @demo\/generator \(ping\)/);

    const output = await readFile(path.join(appRoot, "tmp", "generator-subcommand.txt"), "utf8");
    assert.equal(output, "ping:a,b");
  });
});
