import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  validateApiSummarySurfaces,
  validateCapabilityClosure,
  validateMigrations,
  validateProviderList,
  validateRemovedProps,
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
    await mkdir(path.join(migrationsRoot, "constraints"));
    await writeFile(
      path.join(migrationsRoot, "constraints", "example_users_foreign_key.cjs"),
      "exports.up = async function up() {}; exports.down = async function down() {};\n",
      "utf8"
    );
    const record = packageRecord(packageRoot, { migrationDirectories: ["migrations"] });
    const owners = new Map();

    await validateMigrations(record, owners);
    assert.equal(owners.get("example_initial.cjs"), "@jskit-ai/example");
    assert.equal(owners.get("example_users_foreign_key.cjs"), "@jskit-ai/example");

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

test("migration verification requires after to name packages the package depends on, beside its directories", async () => {
  await withTempPackage(async (packageRoot) => {
    await mkdir(path.join(packageRoot, "migrations"));
    await writeFile(
      path.join(packageRoot, "migrations", "example_initial.cjs"),
      "exports.up = async function up() {}; exports.down = async function down() {};\n",
      "utf8"
    );
    const withAfter = (migrations, dependencies = { "@jskit-ai/users-core": "1.0.0" }) => {
      const record = packageRecord(packageRoot);
      record.packageJson.dependencies = dependencies;
      record.packageJson.jskit.migrations = migrations;
      return record;
    };

    await validateMigrations(withAfter({ directories: ["migrations"], after: ["@jskit-ai/users-core"] }), new Map());
    const failures = [
      [withAfter({ directories: ["migrations"], after: ["@jskit-ai/workspaces-core"] }), /names @jskit-ai\/workspaces-core, which it does not depend on/u],
      [withAfter({ directories: ["migrations"], after: ["@jskit-ai/example"] }), /after names the package itself/u],
      [withAfter({ directories: ["migrations"], after: "@jskit-ai/users-core" }), /after must be an array of non-empty strings/u],
      [withAfter({ after: ["@jskit-ai/users-core"] }), /after needs jskit\.migrations\.directories/u]
    ];
    for (const [record, message] of failures) {
      await assert.rejects(validateMigrations(record, new Map()), message);
    }
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
            requires: ["runtime.env", "client.vue"]
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

test("application requirements are explicit, local to the consumer, and remain required", () => {
  const owner = { packageJson: { name: "@jskit-ai/example", jskit: { capabilities: {
    requires: ["example.policy"], applicationRequires: ["example.policy"]
  } } } };
  assert.doesNotThrow(() => validateCapabilityClosure([owner]));
  const other = { packageJson: { name: "@jskit-ai/other", jskit: { capabilities: {
    requires: ["example.policy"]
  } } } };
  assert.throws(() => validateCapabilityClosure([owner, other]), /requires capability example\.policy/u);
  owner.packageJson.jskit.capabilities.requires = [];
  assert.throws(() => validateCapabilityClosure([owner]), /must also appear in requires/u);
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

test("every package takes the table runtime as a peer, the runtime's own packages too", () => {
  const consumer = (section) => [{
    packageJson: { name: "@jskit-ai/example-core", [section]: { "@jskit-ai/resource-runtime": "0.2.12" }, jskit: {} }
  }];
  assert.doesNotThrow(() => validateSingletonPeerDependencies(consumer("peerDependencies")));
  for (const section of ["dependencies", "optionalDependencies"]) {
    assert.throws(
      () => validateSingletonPeerDependencies(consumer(section)),
      new RegExp(`example-core#${section}\\.@jskit-ai/resource-runtime must be declared in peerDependencies because ` +
        "@jskit-ai/resource-runtime is the application's one table runtime", "u")
    );
  }
  for (const name of ["@jskit-ai/resource-runtime", "@jskit-ai/database-runtime-mysql"]) {
    assert.throws(
      () => validateSingletonPeerDependencies([{
        packageJson: { name, dependencies: { "@jskit-ai/database-runtime": "0.1.262" }, jskit: {} }
      }]),
      new RegExp(`${name}#dependencies\\.@jskit-ai/database-runtime must be declared in peerDependencies`, "u")
    );
  }
});

test("an apiSummary surface names an exported entrypoint or a group of them", () => {
  const packageJson = {
    name: "@jskit-ai/example",
    exports: { "./server": "./src/server/index.js", "./shared/dialect": "./src/shared/dialect.js" },
    jskit: { metadata: { apiSummary: { surfaces: [{ subpath: "./server" }, { subpath: "./shared" }] } } }
  };
  assert.doesNotThrow(() => validateApiSummarySurfaces(packageJson));
  packageJson.jskit.metadata.apiSummary.surfaces.push({ subpath: "./server/host" });
  assert.throws(
    () => validateApiSummarySurfaces(packageJson),
    /@jskit-ai\/example#jskit\.metadata\.apiSummary describes \.\/server\/host, which the package does not export/u
  );
});

test("a removed prop is listed for an exported component, with a hint", () => {
  const packageJson = {
    name: "@jskit-ai/example",
    exports: { "./client/components/RecordScreen": "./src/client/components/RecordScreen.vue" },
    jskit: { metadata: { ui: { removedProps: { RecordScreen: { pluralTitle: "The Up arrow names the list." } } } } }
  };
  assert.doesNotThrow(() => validateRemovedProps(packageJson));
  packageJson.jskit.metadata.ui.removedProps.RecordScreen.backLabel = " ";
  assert.throws(() => validateRemovedProps(packageJson), /removedProps\.RecordScreen\.backLabel says nothing/u);
  packageJson.jskit.metadata.ui.removedProps = { RecordMenu: { label: "Use title." } };
  assert.throws(() => validateRemovedProps(packageJson), /lists RecordMenu, which the package does not export as \.\/client\/components\/RecordMenu/u);
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
