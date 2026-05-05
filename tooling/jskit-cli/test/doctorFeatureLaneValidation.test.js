import assert from "node:assert/strict";
import {
  mkdir,
  unlink,
  writeFile
} from "node:fs/promises";
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

async function scaffoldFeaturePackage(appRoot, featureName = "booking-engine", extraArgs = []) {
  const result = runCli({
    cwd: appRoot,
    args: ["generate", "feature-server-generator", "scaffold", featureName, ...extraArgs]
  });
  assert.equal(result.status, 0, String(result.stderr || ""));
}

async function writeAppFile(appRoot, relativePath, sourceText) {
  const absolutePath = path.join(appRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, sourceText, "utf8");
}

async function createMainPackage(appRoot, { extraService = false } = {}) {
  await writeAppFile(
    appRoot,
    "packages/main/package.json",
    `${JSON.stringify(
      {
        name: "@local/main",
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`
  );

  await writeAppFile(
    appRoot,
    "packages/main/package.descriptor.mjs",
    `export default Object.freeze({
  packageId: "@local/main",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/providers/MainServiceProvider.js",
          export: "MainServiceProvider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  capabilities: {
    provides: [],
    requires: []
  },
  metadata: {},
  mutations: {
    files: []
  }
});
`
  );

  await writeAppFile(
    appRoot,
    "packages/main/src/server/providers/MainServiceProvider.js",
    `class MainServiceProvider {
  static id = "local.main";

  register(app) {
    void app;
  }

  boot() {}
}

export { MainServiceProvider };
`
  );
  await writeAppFile(appRoot, "packages/main/src/server/index.js", "export {};\n");
  await writeAppFile(appRoot, "packages/main/src/server/routes/index.js", "export {};\n");
  await writeAppFile(appRoot, "packages/main/src/server/services/index.js", "export {};\n");
  await writeAppFile(appRoot, "packages/main/src/server/controllers/index.js", "export {};\n");
  await writeAppFile(
    appRoot,
    "packages/main/src/server/support/loadAppConfig.js",
    "async function loadAppConfig() { return {}; }\nexport { loadAppConfig };\n"
  );

  if (extraService) {
    await writeAppFile(
      appRoot,
      "packages/main/src/server/services/BookingEngineService.js",
      "class BookingEngineService {}\nexport { BookingEngineService };\n"
    );
  }
}

async function createHandmadeFeaturePackage(appRoot, featureName = "billing-engine") {
  const featurePascal = "BillingEngine";
  await writeAppFile(
    appRoot,
    `packages/${featureName}/package.json`,
    `${JSON.stringify(
      {
        name: `@local/${featureName}`,
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`
  );

  await writeAppFile(
    appRoot,
    `packages/${featureName}/package.descriptor.mjs`,
    `export default Object.freeze({
  packageId: "@local/${featureName}",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/${featurePascal}Provider.js",
          export: "${featurePascal}Provider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  capabilities: {
    provides: [
      "feature.${featureName}"
    ],
    requires: [
      "runtime.actions"
    ]
  },
  metadata: {
    apiSummary: {
      containerTokens: {
        server: [
          "feature.${featureName}.service"
        ],
        client: []
      }
    }
  },
  mutations: {
    files: []
  }
});
`
  );

  await writeAppFile(
    appRoot,
    `packages/${featureName}/src/server/${featurePascal}Provider.js`,
    `class ${featurePascal}Provider {
  static id = "feature.${featureName}";

  register(app) {
    void app;
  }

  boot() {}
}

export { ${featurePascal}Provider };
`
  );
  await writeAppFile(
    appRoot,
    `packages/${featureName}/src/server/actionIds.js`,
    "const actionIds = Object.freeze({ getStatus: \"feature.billing-engine.status.read\" });\nexport { actionIds };\n"
  );
  await writeAppFile(
    appRoot,
    `packages/${featureName}/src/server/inputSchemas.js`,
    "const statusQueryInputValidator = {};\nexport { statusQueryInputValidator };\n"
  );
  await writeAppFile(
    appRoot,
    `packages/${featureName}/src/server/actions.js`,
    "const featureActions = [];\nexport { featureActions };\n"
  );
  await writeAppFile(
    appRoot,
    `packages/${featureName}/src/server/service.js`,
    "function createService() { return {}; }\nexport { createService };\n"
  );
}

test("doctor accepts a valid generated default-lane feature package", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-feature-lane-valid-app");
    await createMinimalApp(appRoot, { name: "doctor-feature-lane-valid-app" });
    await scaffoldFeaturePackage(appRoot);

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 0, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.deepEqual(payload.issues, []);
    assert.deepEqual(payload.warnings, []);
  });
});

test("doctor flags default-lane services that use knex directly", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-feature-lane-service-knex-app");
    await createMinimalApp(appRoot, { name: "doctor-feature-lane-service-knex-app" });
    await scaffoldFeaturePackage(appRoot);

    await writeAppFile(
      appRoot,
      "packages/booking-engine/src/server/service.js",
      `function createService({ featureRepository, knex } = {}) {
  void featureRepository;
  void knex;
  return Object.freeze({
    async getStatus() {
      return {};
    },
    async execute() {
      return {};
    }
  });
}

export { createService };
`
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.match(
      String(payload.issues[0] || ""),
      /packages\/booking-engine\/src\/server\/service\.js:\d+: \[feature-lane:service-knex\]/
    );
  });
});

test("doctor flags default-lane services that import persistence helpers directly", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-feature-lane-service-import-app");
    await createMinimalApp(appRoot, { name: "doctor-feature-lane-service-import-app" });
    await scaffoldFeaturePackage(appRoot);

    await writeAppFile(
      appRoot,
      "packages/booking-engine/src/server/service.js",
      `import { createJsonRestContext } from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";

function createService({ featureRepository } = {}) {
  void featureRepository;
  void createJsonRestContext;
  return Object.freeze({
    async getStatus() {
      return {};
    },
    async execute() {
      return {};
    }
  });
}

export { createService };
`
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.match(
      String(payload.issues[0] || ""),
      /packages\/booking-engine\/src\/server\/service\.js:\d+: \[feature-lane:service-persistence-import\]/
    );
  });
});

test("doctor flags default-lane providers that perform persistence work directly", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-feature-lane-provider-persistence-app");
    await createMinimalApp(appRoot, { name: "doctor-feature-lane-provider-persistence-app" });
    await scaffoldFeaturePackage(appRoot);

    await writeAppFile(
      appRoot,
      "packages/booking-engine/src/server/BookingEngineProvider.js",
      `import { createJsonRestContext } from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";

class BookingEngineProvider {
  static id = "feature.booking-engine";

  register(app) {
    const jsonRestContext = createJsonRestContext(null);
    void app;
    void jsonRestContext;
  }

  boot() {}
}

export { BookingEngineProvider };
`
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.match(
      String(payload.issues[0] || ""),
      /packages\/booking-engine\/src\/server\/BookingEngineProvider\.js:\d+: \[feature-lane:provider-persistence-direct\]/
    );
  });
});

test("doctor requires repositories for generated persistent feature packages", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-feature-lane-repository-required-app");
    await createMinimalApp(appRoot, { name: "doctor-feature-lane-repository-required-app" });
    await scaffoldFeaturePackage(appRoot);

    await unlink(path.join(appRoot, "packages", "booking-engine", "src", "server", "repository.js"));

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.match(
      String(payload.issues[0] || ""),
      /packages\/booking-engine\/src\/server\/repository\.js: \[feature-lane:repository-required\]/
    );
  });
});

test("doctor flags default-lane repositories that bypass the json-rest-api path", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-feature-lane-repository-path-app");
    await createMinimalApp(appRoot, { name: "doctor-feature-lane-repository-path-app" });
    await scaffoldFeaturePackage(appRoot);

    await writeAppFile(
      appRoot,
      "packages/booking-engine/src/server/repository.js",
      `import { createWithTransaction } from "@jskit-ai/database-runtime/shared";

function createRepository({ knex } = {}) {
  const withTransaction = createWithTransaction(knex);
  return {
    withTransaction
  };
}

export { createRepository };
`
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.match(
      String(payload.issues[0] || ""),
      /packages\/booking-engine\/src\/server\/repository\.js:\d+: \[feature-lane:repository-default-path\]/
    );
  });
});

test("doctor emits warnings for packages/main feature creep and hand-made feature packages", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-feature-lane-warnings-app");
    await createMinimalApp(appRoot, { name: "doctor-feature-lane-warnings-app" });
    await createMainPackage(appRoot, { extraService: true });
    await createHandmadeFeaturePackage(appRoot);

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 0, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.deepEqual(payload.issues, []);
    assert.equal(payload.warnings.length, 2);
    assert.match(
      String(payload.warnings[0] || ""),
      /\[feature-lane:handmade-feature\]|\[feature-lane:main-glue-only\]/
    );
    assert.match(
      `${payload.warnings.join("\n")}`,
      /\[feature-lane:main-glue-only\]/
    );
    assert.match(
      `${payload.warnings.join("\n")}`,
      /\[feature-lane:handmade-feature\]/
    );
  });
});
