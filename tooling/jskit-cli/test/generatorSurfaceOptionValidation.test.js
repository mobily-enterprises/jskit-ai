import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function fileExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function createMinimalApp(appRoot, { name = "tmp-app" } = {}) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
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
  await writeFile(
    path.join(appRoot, "config", "public.js"),
    [
      "export const config = {};",
      'config.surfaceDefaultId = "admin";',
      "config.surfaceDefinitions = {};",
      'config.surfaceDefinitions.admin = { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true, requiresWorkspace: true };',
      'config.surfaceDefinitions.console = { id: "console", pagesRoot: "console", enabled: true, requiresWorkspace: false };',
      'config.surfaceDefinitions.disabled = { id: "disabled", pagesRoot: "disabled", enabled: false, requiresWorkspace: false };',
      ""
    ].join("\n"),
    "utf8"
  );
}

async function writeSubcommandGeneratorPackage(appRoot) {
  const packageRoot = path.join(appRoot, "packages", "subcommand-generator");
  await mkdir(path.join(packageRoot, "src", "server", "subcommands"), { recursive: true });

  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@demo/subcommand-generator",
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
  packageId: "@demo/subcommand-generator",
  version: "0.1.0",
  kind: "generator",
  description: "Demo generator with explicit subcommand validation.",
  options: {
    name: {
      required: true,
      inputType: "text"
    },
    surface: {
      required: true,
      inputType: "text",
      validationType: "enabled-surface-id"
    }
  },
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
      element: {
        entrypoint: "src/server/subcommands/element.js",
        export: "runGeneratorSubcommand",
        optionNames: ["name", "surface"],
        requiredOptionNames: ["name", "surface"]
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
    path.join(packageRoot, "src", "server", "subcommands", "element.js"),
    `import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

async function runGeneratorSubcommand({ appRoot } = {}) {
  const targetPath = path.join(appRoot, "tmp", "subcommand-generator.txt");
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, "generated\\n", "utf8");
  return {
    touchedFiles: ["tmp/subcommand-generator.txt"],
    summary: "generated"
  };
}

export { runGeneratorSubcommand };
`,
    "utf8"
  );
}

async function writePrimaryGeneratorPackage(appRoot) {
  const packageRoot = path.join(appRoot, "packages", "primary-generator");
  await mkdir(path.join(packageRoot, "templates"), { recursive: true });

  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@demo/primary-generator",
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "templates", "marker.txt"),
    "primary-generated\n",
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageVersion: 1,
  packageId: "@demo/primary-generator",
  version: "0.1.0",
  kind: "generator",
  description: "Demo generator with add/install-style primary command.",
  options: {
    surface: {
      required: true,
      inputType: "text",
      validationType: "enabled-surface-id"
    }
  },
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
    generatorPrimarySubcommand: "setup",
    generatorSubcommands: {
      setup: {
        description: "Primary setup flow.",
        optionNames: ["surface"],
        requiredOptionNames: ["surface"]
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
    files: [
      {
        from: "templates/marker.txt",
        to: "tmp/primary-generator.txt"
      }
    ],
    text: []
  }
});
`,
    "utf8"
  );
}

async function writeCreateTargetPrimaryGeneratorPackage(appRoot) {
  const packageRoot = path.join(appRoot, "packages", "create-target-generator");
  await mkdir(path.join(packageRoot, "templates"), { recursive: true });

  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@demo/create-target-generator",
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "templates", "marker.txt"),
    "create-target-generated\n",
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageVersion: 1,
  packageId: "@demo/create-target-generator",
  version: "0.1.0",
  kind: "generator",
  description: "Demo generator with a create-target preflight.",
  options: {
    namespace: {
      required: true,
      inputType: "text"
    },
    force: {
      required: false,
      inputType: "flag",
      defaultValue: ""
    }
  },
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
    generatorPrimarySubcommand: "scaffold",
    generatorSubcommands: {
      scaffold: {
        description: "Primary scaffold flow.",
        optionNames: ["namespace", "force"],
        requiredOptionNames: ["namespace"],
        createTarget: {
          pathTemplate: "packages/\${option:namespace|kebab}",
          label: "package directory",
          allowExistingEmptyDirectory: false
        }
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
    files: [
      {
        from: "templates/marker.txt",
        to: "packages/\${option:namespace|kebab}/marker.txt"
      }
    ],
    text: []
  }
});
`,
    "utf8"
  );
}

test("generate explicit subcommands reject unknown surface ids before executing", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "generator-surface-validation-subcommand");
    await createMinimalApp(appRoot, { name: "generator-surface-validation-subcommand" });
    await writeSubcommandGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@demo/subcommand-generator",
        "element",
        "--name",
        "Widget",
        "--surface",
        "missing"
      ]
    });

    assert.equal(result.status, 1);
    assert.match(
      String(result.stderr || ""),
      /Invalid option for package @demo\/subcommand-generator: --surface references unknown surface "missing" in config\/public\.js\./
    );
    assert.equal(await fileExists(path.join(appRoot, "tmp", "subcommand-generator.txt")), false);
  });
});

test("generate primary install-style commands reject disabled surface ids before mutations", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "generator-surface-validation-primary");
    await createMinimalApp(appRoot, { name: "generator-surface-validation-primary" });
    await writePrimaryGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@demo/primary-generator",
        "setup",
        "--surface",
        "disabled"
      ]
    });

    assert.equal(result.status, 1);
    assert.match(
      String(result.stderr || ""),
      /Invalid option for package @demo\/primary-generator: --surface references disabled surface "disabled" in config\/public\.js\./
    );
    assert.equal(await fileExists(path.join(appRoot, "tmp", "primary-generator.txt")), false);
    assert.equal(await fileExists(path.join(appRoot, ".jskit", "lock.json")), false);
  });
});

test("generate primary install-style commands with required options do not show help on bare invocation", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "generator-primary-missing-option");
    await createMinimalApp(appRoot, { name: "generator-primary-missing-option" });
    await writePrimaryGeneratorPackage(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "@demo/primary-generator", "setup"]
    });

    assert.equal(result.status, 1);
    assert.match(
      String(result.stderr || ""),
      /package @demo\/primary-generator requires option surface\. Non-interactive mode requires --surface <value>\./i
    );
    assert.doesNotMatch(String(result.stdout || ""), /Generator subcommand help:/);
    assert.equal(await fileExists(path.join(appRoot, "tmp", "primary-generator.txt")), false);
    assert.equal(await fileExists(path.join(appRoot, ".jskit", "lock.json")), false);
  });
});

test("generate primary install-style commands reject existing create targets unless --force is passed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "generator-create-target-policy");
    await createMinimalApp(appRoot, { name: "generator-create-target-policy" });
    await writeCreateTargetPrimaryGeneratorPackage(appRoot);
    await mkdir(path.join(appRoot, "packages", "demo-thing"), { recursive: true });

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@demo/create-target-generator",
        "scaffold",
        "--namespace",
        "Demo Thing"
      ]
    });

    assert.equal(result.status, 1);
    assert.match(
      String(result.stderr || ""),
      /create-target-generator scaffold will not overwrite existing package directory packages\/demo-thing\. Re-run with --force to overwrite it\./
    );
    assert.equal(await fileExists(path.join(appRoot, "packages", "demo-thing", "marker.txt")), false);
    assert.equal(await fileExists(path.join(appRoot, ".jskit", "lock.json")), false);
  });
});

test("generate primary install-style commands allow existing create targets when --force is passed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "generator-create-target-policy-force");
    await createMinimalApp(appRoot, { name: "generator-create-target-policy-force" });
    await writeCreateTargetPrimaryGeneratorPackage(appRoot);
    await mkdir(path.join(appRoot, "packages", "demo-thing"), { recursive: true });

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "@demo/create-target-generator",
        "scaffold",
        "--namespace",
        "Demo Thing",
        "--force"
      ]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const markerSource = await readFile(path.join(appRoot, "packages", "demo-thing", "marker.txt"), "utf8");
    assert.equal(markerSource, "create-target-generated\n");
  });
});
