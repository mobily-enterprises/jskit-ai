import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

const WIDGET_MARKER = "WIDGET_MARKER";

async function createMinimalApp(appRoot, { name = "tmp-app" } = {}) {
  await mkdir(path.join(appRoot, "src"), { recursive: true });
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

async function writeLocalPackageDescriptor(
  appRoot,
  {
    slug = "",
    packageId = "",
    version = "0.1.0",
    kind = "runtime",
    dependsOn = [],
    filesMutations = [],
    textMutations = []
  } = {}
) {
  const packageRoot = path.join(appRoot, "packages", slug);
  await mkdir(packageRoot, { recursive: true });

  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: packageId,
        version,
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
  packageId: ${JSON.stringify(packageId)},
  version: ${JSON.stringify(version)},
  kind: ${JSON.stringify(kind)},
  description: "Local package for generate dependency reinstall regression coverage.",
  options: {},
  dependsOn: ${JSON.stringify(dependsOn)},
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
    procfile: {},
    files: ${JSON.stringify(filesMutations, null, 2)},
    text: ${JSON.stringify(textMutations, null, 2)}
  }
});
`,
    "utf8"
  );
}

async function writeBaseTemplatePlacement(appRoot, { slug = "base" } = {}) {
  const templatePath = path.join(appRoot, "packages", slug, "templates", "src", "placement.js");
  await mkdir(path.dirname(templatePath), { recursive: true });
  await writeFile(
    templatePath,
    `export default function getPlacements() {
  return ["base"];
}
`,
    "utf8"
  );
}

test("generate keeps already-installed dependency placements instead of reapplying transitive dependency installs", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "generate-dependency-reapply-app");
    await createMinimalApp(appRoot, { name: "generate-dependency-reapply-app" });

    await writeLocalPackageDescriptor(appRoot, {
      slug: "base",
      packageId: "@demo/base",
      version: "0.1.0",
      kind: "runtime",
      filesMutations: [
        {
          from: "templates/src/placement.js",
          to: "src/placement.js",
          id: "base-placement"
        }
      ]
    });
    await writeBaseTemplatePlacement(appRoot, { slug: "base" });

    await writeLocalPackageDescriptor(appRoot, {
      slug: "widget",
      packageId: "@demo/widget",
      version: "0.1.0",
      kind: "runtime",
      dependsOn: ["@demo/base"],
      textMutations: [
        {
          op: "append-text",
          file: "src/placement.js",
          id: "widget-placement",
          value: `\n// ${WIDGET_MARKER}\n`
        }
      ]
    });

    await writeLocalPackageDescriptor(appRoot, {
      slug: "generator",
      packageId: "@demo/generator",
      version: "0.1.0",
      kind: "generator",
      dependsOn: ["@demo/base"]
    });

    const addBaseResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/base"]
    });
    assert.equal(addBaseResult.status, 0, String(addBaseResult.stderr || ""));

    const addWidgetResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/widget"]
    });
    assert.equal(addWidgetResult.status, 0, String(addWidgetResult.stderr || ""));

    const placementBeforeGenerate = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementBeforeGenerate, new RegExp(WIDGET_MARKER));

    await writeLocalPackageDescriptor(appRoot, {
      slug: "base",
      packageId: "@demo/base",
      version: "0.2.0",
      kind: "runtime",
      filesMutations: [
        {
          from: "templates/src/placement.js",
          to: "src/placement.js",
          id: "base-placement"
        }
      ]
    });
    await writeBaseTemplatePlacement(appRoot, { slug: "base" });

    const generateResult = runCli({
      cwd: appRoot,
      args: ["generate", "@demo/generator"]
    });
    assert.equal(generateResult.status, 0, String(generateResult.stderr || ""));

    const placementAfterGenerate = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementAfterGenerate, new RegExp(WIDGET_MARKER));

    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    assert.equal(lock?.installedPackages?.["@demo/base"]?.version, "0.1.0");
  });
});
