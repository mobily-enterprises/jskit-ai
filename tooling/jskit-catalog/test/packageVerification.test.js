import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  validateCapabilityClosure,
  validateMigrations,
  validateProviderList,
  validateSingletonPeerDependencies
} from "../scripts/verify-packages.mjs";

function packageRecord(packageRoot, {
  name = "@jskit-ai/example",
  serverProviders = [],
  migrationDirectories
} = {}) {
  return {
    packageRoot,
    packageJson: {
      name,
      jskit: {
        runtime: {
          server: { providers: serverProviders },
          client: { providers: [] }
        },
        ...(migrationDirectories
          ? { migrations: { directories: migrationDirectories } }
          : {})
      }
    }
  };
}

async function withTempPackage(run) {
  const packageRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-package-verification-"));
  try {
    await run(packageRoot);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
}

test("server provider verification imports the declared export and checks its capability contract", async () => {
  await withTempPackage(async (packageRoot) => {
    await writeFile(
      path.join(packageRoot, "provider.mjs"),
      `export const ExampleProvider = Object.freeze({
        id: "example.provider",
        requires: Object.freeze({ env: "runtime.env" }),
        optional: Object.freeze({ logger: "runtime.logger" }),
        provides: Object.freeze({ example: "example.runtime" }),
        setup() { return { example: true }; },
        boot: null,
        shutdown: null
      });\n`,
      "utf8"
    );
    const record = packageRecord(packageRoot, {
      serverProviders: [{ entrypoint: "provider.mjs", export: "ExampleProvider" }]
    });

    assert.equal(await validateProviderList(record, "server"), 1);

    record.packageJson.jskit.runtime.server.providers[0].export = "MissingProvider";
    await assert.rejects(
      validateProviderList(record, "server"),
      /export "MissingProvider" was not found/u
    );
  });
});

test("server provider verification rejects an exported object that is not a provider", async () => {
  await withTempPackage(async (packageRoot) => {
    await writeFile(path.join(packageRoot, "provider.mjs"), "export const InvalidProvider = {};\n", "utf8");
    const record = packageRecord(packageRoot, {
      serverProviders: [{ entrypoint: "provider.mjs", export: "InvalidProvider" }]
    });

    await assert.rejects(
      validateProviderList(record, "server"),
      /InvalidProvider.*\.id must match/u
    );
  });
});

test("migration verification imports every migration and requires reversible entrypoints", async () => {
  await withTempPackage(async (packageRoot) => {
    const migrationsRoot = path.join(packageRoot, "migrations");
    await mkdir(migrationsRoot);
    await writeFile(
      path.join(migrationsRoot, "example_initial.cjs"),
      "exports.up = async function up() {}; exports.down = async function down() {};\n",
      "utf8"
    );
    const record = packageRecord(packageRoot, { migrationDirectories: ["migrations"] });
    const owners = new Map();

    await validateMigrations(record, owners);
    assert.equal(owners.get("example_initial.cjs"), "@jskit-ai/example");

    await writeFile(
      path.join(migrationsRoot, "invalid_followup.cjs"),
      "exports.up = async function up() {};\n",
      "utf8"
    );
    await assert.rejects(
      validateMigrations(record, new Map()),
      /invalid_followup\.cjs must export up\(\) and down\(\)/u
    );
  });
});

test("catalog capability verification accepts kernel inputs and rejects an unprovided requirement", () => {
  const packages = [
    {
      packageJson: {
        name: "@jskit-ai/base",
        jskit: {
          capabilities: {
            provides: ["example.base"],
            requires: ["runtime.env"]
          }
        }
      }
    },
    {
      packageJson: {
        name: "@jskit-ai/consumer",
        jskit: {
          capabilities: {
            provides: [],
            requires: ["example.base"]
          }
        }
      }
    }
  ];

  assert.doesNotThrow(() => validateCapabilityClosure(packages));
  packages[1].packageJson.jskit.capabilities.requires = ["example.missing"];
  assert.throws(
    () => validateCapabilityClosure(packages),
    /requires capability example\.missing/u
  );
});

test("packages consume shared client runtimes through peer dependencies", () => {
  const packages = [
    {
      packageJson: {
        name: "@jskit-ai/shell-web",
        jskit: { metadata: { client: { singleton: true } } }
      }
    },
    {
      packageJson: {
        name: "@jskit-ai/assistant-runtime",
        peerDependencies: {
          "@jskit-ai/kernel": "0.1.2",
          "@jskit-ai/shell-web": "0.1.2"
        },
        jskit: { metadata: { client: { singleton: true } } }
      }
    }
  ];

  assert.doesNotThrow(() => validateSingletonPeerDependencies(packages));
  packages[1].packageJson.dependencies = { "@jskit-ai/shell-web": "0.1.2" };
  delete packages[1].packageJson.peerDependencies["@jskit-ai/shell-web"];
  assert.throws(
    () => validateSingletonPeerDependencies(packages),
    /assistant-runtime#dependencies\.@jskit-ai\/shell-web must be declared in peerDependencies/u
  );
});

test("kernel is always treated as shared client infrastructure", () => {
  assert.throws(
    () => validateSingletonPeerDependencies([{
      packageJson: {
        name: "@jskit-ai/example",
        dependencies: { "@jskit-ai/kernel": "0.1.2" },
        jskit: {}
      }
    }]),
    /@jskit-ai\/kernel owns shared client runtime state/u
  );
});
