import assert from "node:assert/strict";
import test from "node:test";
import { runPackageAddCommand } from "../src/server/commandHandlers/packageCommands/add.js";
import { createCommandHandlerShared } from "../src/server/commandHandlers/shared.js";

test("add package reports fetching status when template source is materialized", async () => {
  const packageEntry = {
    packageId: "@jskit-ai/demo-package",
    version: "1.2.3",
    descriptor: {
      kind: "runtime",
      options: {},
      mutations: {}
    }
  };
  const packageRegistry = new Map([[packageEntry.packageId, packageEntry]]);
  let stdout = "";
  const { createCatalogFetchStatusReporter } = createCommandHandlerShared({});

  const exitCode = await runPackageAddCommand(
    {
      createCliError(message) {
        return new Error(String(message || ""));
      },
      normalizeRelativePath: (_appRoot, targetPath) => String(targetPath || ""),
      resolveAppRootFromCwd: async (cwd) => cwd,
      loadPackageRegistry: async () => packageRegistry,
      loadAppLocalPackageRegistry: async () => new Map(),
      loadBundleRegistry: async () => new Map(),
      mergePackageRegistries: (...registries) => {
        const merged = new Map();
        for (const registry of registries) {
          for (const [packageId, entry] of registry.entries()) {
            merged.set(packageId, entry);
          }
        }
        return merged;
      },
      loadAppPackageJson: async () => ({
        packageJsonPath: "/tmp/demo-app/package.json",
        packageJson: {}
      }),
      loadLockFile: async () => ({
        lockPath: "/tmp/demo-app/.jskit/lock.json",
        lock: {
          installedPackages: {}
        }
      }),
      resolvePackageIdFromRegistryOrNodeModules: async ({ packageIdInput }) => packageIdInput,
      hydratePackageRegistryFromInstalledNodeModules: async () => {},
      resolvePackageKind: () => "runtime",
      validateInlineOptionsForPackage: () => {},
      resolveLocalDependencyOrder: (packageIds) => ({
        ordered: packageIds,
        externalDependencies: []
      }),
      validatePlannedCapabilityClosure: () => {},
      validateInlineOptionsForBundle: () => {},
      resolveBundleInlineOptionsForPackage: () => ({}),
      resolvePackageOptions: async () => ({}),
      applyPackageInstall: async ({ packageEntry, reportTemplateFetchStatus, touchedFiles }) => {
        assert.equal(typeof reportTemplateFetchStatus, "function");
        reportTemplateFetchStatus({
          packageEntry,
          state: "start"
        });
        reportTemplateFetchStatus({
          packageEntry,
          state: "complete"
        });
        touchedFiles.add("package.json");
        return {};
      },
      adoptAppLocalPackageDependencies: async () => ({
        appLocalRegistry: new Map(),
        adoptedPackageIds: []
      }),
      writeJsonFile: async () => {},
      runNpmInstall: async () => {},
      renderResolvedSummary: () => "Added package demo.",
      createCatalogFetchStatusReporter
    },
    {
      positional: ["package", "@jskit-ai/demo-package"],
      options: {
        inlineOptions: {},
        dryRun: false,
        json: false
      },
      cwd: "/tmp/demo-app",
      io: {
        stdout: {
          write(value) {
            stdout += String(value || "");
          }
        },
        stderr: { write() {} }
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.match(stdout, /Fetching @jskit-ai\/demo-package@1\.2\.3\.\.\./);
  assert.match(stdout, /Fetching @jskit-ai\/demo-package@1\.2\.3\.\.\. done!/);
});
