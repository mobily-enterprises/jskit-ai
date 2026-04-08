import assert from "node:assert/strict";
import test from "node:test";
import { runPackageGenerateCommand } from "../src/server/commandHandlers/packageCommands/generate.js";

test("generate subcommands resolve package template root before invoking generator entrypoint", async () => {
  const packageEntry = {
    packageId: "@jskit-ai/demo-generator",
    rootDir: "",
    descriptor: {
      kind: "generator",
      metadata: {
        generatorSubcommands: {
          page: {
            entrypoint: "src/server/subcommands/page.js"
          }
        }
      }
    }
  };
  const packageRegistry = new Map([[packageEntry.packageId, packageEntry]]);
  const runCalls = [];

  const exitCode = await runPackageGenerateCommand(
    {
      createCliError(message) {
        return new Error(String(message || ""));
      },
      resolveAppRootFromCwd: async (cwd) => cwd,
      loadPackageRegistry: async () => packageRegistry,
      loadAppLocalPackageRegistry: async () => new Map(),
      mergePackageRegistries: (...registries) => {
        const merged = new Map();
        for (const registry of registries) {
          for (const [packageId, entry] of registry.entries()) {
            merged.set(packageId, entry);
          }
        }
        return merged;
      },
      resolvePackageIdFromRegistryOrNodeModules: async ({ packageIdInput }) => packageIdInput,
      hydratePackageRegistryFromInstalledNodeModules: async () => {},
      resolvePackageTemplateRoot: async () => "/tmp/materialized-generator",
      resolvePackageKind: () => "generator",
      resolveGeneratorPrimarySubcommand: () => "",
      hasGeneratorSubcommandDefinition: () => true,
      runGeneratorSubcommand: async (payload) => {
        runCalls.push(payload);
        return 0;
      }
    },
    {
      positional: ["@jskit-ai/demo-generator", "page"],
      options: {
        inlineOptions: {},
        dryRun: false,
        json: false
      },
      cwd: "/tmp/demo-app",
      io: {
        stdout: { write() {} },
        stderr: { write() {} }
      }
    },
    {
      runCommandAdd: async () => {
        throw new Error("runCommandAdd should not be called for explicit subcommands");
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0].packageEntry.rootDir, "/tmp/materialized-generator");
});
