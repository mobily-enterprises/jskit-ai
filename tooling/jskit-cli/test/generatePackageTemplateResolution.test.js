import assert from "node:assert/strict";
import test from "node:test";
import { runPackageGenerateCommand } from "../src/server/commandHandlers/packageCommands/generate.js";
import { createCommandHandlerShared } from "../src/server/commandHandlers/shared.js";

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
  let stdout = "";
  const { createCatalogFetchStatusReporter } = createCommandHandlerShared({});

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
      resolvePackageTemplateRoot: async ({ packageEntry, reportTemplateFetchStatus }) => {
        reportTemplateFetchStatus({
          packageEntry,
          state: "start"
        });
        reportTemplateFetchStatus({
          packageEntry,
          state: "complete"
        });
        return "/tmp/materialized-generator";
      },
      resolvePackageKind: () => "generator",
      resolveGeneratorPrimarySubcommand: () => "",
      hasGeneratorSubcommandDefinition: () => true,
      validateInlineOptionValuesForPackage: async () => {},
      createCatalogFetchStatusReporter,
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
        stdout: { write(value) { stdout += String(value || ""); } },
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
  assert.match(stdout, /Fetching @jskit-ai\/demo-generator\.\.\./);
  assert.match(stdout, /Fetching @jskit-ai\/demo-generator\.\.\. done!/);
});

test("generate routes inline options without an explicit subcommand to the primary subcommand", async () => {
  const packageEntry = {
    packageId: "@jskit-ai/demo-generator",
    rootDir: "",
    descriptor: {
      kind: "generator",
      metadata: {
        generatorPrimarySubcommand: "scaffold",
        generatorSubcommands: {
          scaffold: {
            optionNames: ["namespace"]
          }
        }
      }
    }
  };
  const packageRegistry = new Map([[packageEntry.packageId, packageEntry]]);
  const runCommandAddCalls = [];
  const { createCatalogFetchStatusReporter } = createCommandHandlerShared({});

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
      resolvePackageTemplateRoot: async ({ packageEntry }) => packageEntry.rootDir,
      resolvePackageKind: () => "generator",
      resolveGeneratorPrimarySubcommand: () => "scaffold",
      hasGeneratorSubcommandDefinition: () => false,
      validateInlineOptionValuesForPackage: async () => {},
      createCatalogFetchStatusReporter,
      runGeneratorSubcommand: async () => {
        throw new Error("runGeneratorSubcommand should not be called for descriptor-backed primary subcommands");
      },
      readdir: async () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
    },
    {
      positional: ["@jskit-ai/demo-generator"],
      options: {
        inlineOptions: {
          namespace: "contacts"
        },
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
      runCommandAdd: async (payload) => {
        runCommandAddCalls.push(payload);
        return 0;
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(runCommandAddCalls.length, 1);
  assert.deepEqual(runCommandAddCalls[0].positional, ["package", "@jskit-ai/demo-generator"]);
  assert.equal(runCommandAddCalls[0].options.inlineOptions.namespace, "contacts");
  assert.equal(runCommandAddCalls[0].options.commandMode, "generate");
});
