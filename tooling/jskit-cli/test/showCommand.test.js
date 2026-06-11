import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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

async function createAppWithLocalMain(appRoot) {
  await writeJson(path.join(appRoot, "package.json"), {
    name: "local-show-app",
    version: "0.1.0",
    private: true,
    type: "module",
    dependencies: {
      "@local/main": "file:packages/main"
    }
  });
  await writeJson(path.join(appRoot, ".jskit", "lock.json"), {
    lockVersion: 1,
    installedPackages: {
      "@local/main": {
        packageId: "@local/main",
        version: "0.1.0",
        source: {
          type: "local-package",
          packagePath: "packages/main",
          descriptorPath: "packages/main/package.descriptor.mjs"
        }
      }
    }
  });
  await writeJson(path.join(appRoot, "packages", "main", "package.json"), {
    name: "@local/main",
    version: "0.1.0",
    private: true,
    type: "module"
  });
  await writeFile(
    path.join(appRoot, "packages", "main", "package.descriptor.mjs"),
    `export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/main",
  version: "0.1.0",
  kind: "runtime",
  description: "App-local main composition and glue scaffold.",
  dependsOn: [],
  capabilities: {
    provides: [],
    requires: []
  },
  options: {},
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/MainServiceProvider.js",
          export: "MainServiceProvider"
        }
      ]
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/MainClientProvider.js",
          export: "MainClientProvider"
        }
      ]
    }
  },
  metadata: {
    jskit: {
      ownershipGuidance: {
        title: "App-local main lane",
        summary: "Keep @local/main focused on app composition and lightweight glue."
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
    text: [],
    files: []
  }
});\n`,
    "utf8"
  );
}

test("show package renders grouped file write plan from descriptor mutations", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "auth-web"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = stripVTControlCharacters(String(result.stdout || ""));
  assert.match(stdout, /File writes \(/);
  assert.match(stdout, /UI routes \(/);
  assert.match(stdout, /\/auth\/login \((surface|global)\) \[advisory\] Public login route for authentication flows\. \(id:auth\.login\)/);
  assert.match(stdout, /Server routes \(/);
  assert.match(stdout, /GET \/api\/session: Get current session status and CSRF token/);
  assert.match(stdout, /Summary:/);
  assert.match(
    stdout,
    /@jskit-ai\/auth-web\/client:\n\s+Exports auth web client provider, default auth views, and route\/provider registration surface\./
  );
  assert.match(stdout, /Container tokens -- app\.make\('\.\.\.'\):/);
  assert.match(stdout, /server: auth\.web\.service/);
  assert.match(stdout, /Placement outlets \(\d+\):/);
  assert.match(stdout, /auth-profile-menu:primary-menu/);
  assert.match(stdout, /Placement contributions \(default entries\) \(\d+\):/);
  assert.match(stdout, /auth\.profile\.widget/);
  assert.match(stdout, /auth\.profile\.menu\.sign-out/);
  assert.match(stdout, /Code introspection:\n- Source files unavailable \(descriptor metadata only\)\./);
  assert.match(stdout, /Introspection notes \(\d+\):/);
  assert.match(stdout, /src\/views\/auth\/LoginView\.vue \(id:auth-view-login\):\n\s+Install minimal login container/);
  assert.match(stdout, /src\/views\/auth\/SignOutView\.vue \(id:auth-view-signout\):\n\s+Install minimal sign-out container/);
});

test("show package --details renders expanded capability graph details", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "auth-web", "--details"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = stripVTControlCharacters(String(result.stdout || ""));
  assert.match(stdout, /Capability details:/);
  assert.match(stdout, /Provides detail \(/);
  assert.match(stdout, /Requires detail \(/);
  assert.match(stdout, /auth\.provider/);
  assert.match(stdout, /@jskit-ai\/auth-provider-supabase-core@0\.\d+\.\d+/);
  assert.match(stdout, /providers \(\d+\):/);
  assert.match(stdout, /Code introspection:\n- Source files unavailable \(descriptor metadata only\)\./);
});

test("show feature-server-generator --details renders generator commands and ownership guidance", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "feature-server-generator", "--details"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = stripVTControlCharacters(String(result.stdout || ""));
  assert.match(stdout, /Generator commands \(\d+\):/);
  assert.match(stdout, /scaffold \[primary\]/);
  assert.match(stdout, /booking-engine/);
  assert.match(stdout, /Standard non-CRUD server lane/);
  assert.match(stdout, /provider: wires DI, actions, repository, and optional routes/);
  assert.match(stdout, /packages\/main: stays composition\/glue only/);
});

test("show package resolves app-local packages from the current app", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "local-show-app");
    await createAppWithLocalMain(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: ["show", "@local/main", "--details"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const stdout = stripVTControlCharacters(String(result.stdout || ""));
    assert.match(stdout, /Package:\s+@local\/main/);
    assert.match(stdout, /Descriptor:\s+packages\/main\/package\.descriptor\.mjs/);
    assert.match(stdout, /Description:\s+App-local main composition and glue scaffold\./);
    assert.match(stdout, /App-local main lane/);
  });
});

test("show package --json resolves app-local package payloads from the current app", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "local-show-json-app");
    await createAppWithLocalMain(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: ["show", "@local/main", "--json"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    const payload = JSON.parse(String(result.stdout || "{}"));
    assert.equal(payload.packageId, "@local/main");
    assert.equal(payload.descriptorPath, "packages/main/package.descriptor.mjs");
    assert.equal(payload.description, "App-local main composition and glue scaffold.");
  });
});

test("show package reports missing app-local descriptors recorded in the lock", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "local-show-missing-app");
    await writeJson(path.join(appRoot, "package.json"), {
      name: "local-show-missing-app",
      version: "0.1.0",
      private: true,
      type: "module"
    });
    await writeJson(path.join(appRoot, ".jskit", "lock.json"), {
      lockVersion: 1,
      installedPackages: {
        "@local/main": {
          packageId: "@local/main",
          version: "0.1.0",
          source: {
            type: "local-package",
            packagePath: "packages/main",
            descriptorPath: "packages/main/package.descriptor.mjs"
          }
        }
      }
    });

    const result = runCli({
      cwd: appRoot,
      args: ["show", "@local/main", "--details"]
    });

    assert.equal(result.status, 1);
    assert.match(
      String(result.stderr || ""),
      /Local package @local\/main is recorded in \.jskit\/lock\.json but descriptor is missing at packages\/main\/package\.descriptor\.mjs\./
    );
  });
});

test("show package --debug-exports includes re-export provenance details", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "http-runtime", "--debug-exports"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = stripVTControlCharacters(String(result.stdout || ""));
  assert.match(stdout, /Code introspection:\n- Source files unavailable \(descriptor metadata only\)\./);
  assert.doesNotMatch(stdout, /Package exports \(/);
  assert.doesNotMatch(stdout, /re-export sources:/);
});

test("show package --json includes exports, container bindings, and exported symbols", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "http-runtime", "--json"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const payload = JSON.parse(String(result.stdout || "{}"));

  assert.equal(payload.packageId, "@jskit-ai/http-runtime");
  assert.ok(Array.isArray(payload.packageExports));
  assert.equal(payload.packageExports.length, 0);

  const containerBindings = payload.containerBindings || {};
  const serverBindings = Array.isArray(containerBindings.server) ? containerBindings.server : [];
  const clientBindings = Array.isArray(containerBindings.client) ? containerBindings.client : [];
  assert.equal(serverBindings.length, 0);
  assert.equal(clientBindings.length, 0);

  assert.ok(Array.isArray(payload.exportedSymbols));
  assert.equal(payload.exportedSymbols.length, 0);
  assert.equal(payload.introspection?.available, false);
});

test("show package --json includes symbol summaries for direct export files", () => {
  const result = runCli({
    cwd: path.resolve(path.dirname(CLI_PATH), ".."),
    args: ["show", "auth-provider-supabase-core", "--json"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const payload = JSON.parse(String(result.stdout || "{}"));
  const exportedSymbols = Array.isArray(payload.exportedSymbols) ? payload.exportedSymbols : [];
  assert.equal(exportedSymbols.length, 0);
  assert.equal(payload.introspection?.available, false);
});
