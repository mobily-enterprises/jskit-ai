import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

const require = createRequire(import.meta.url);
const databaseRuntimePackage = require("../../database-runtime/package.json");
const databaseRuntimeMysqlPackage = require("../../database-runtime-mysql/package.json");
const jsonRestApiCorePackage = require("../../json-rest-api-core/package.json");
const kernelPackage = require("../../kernel/package.json");

test("feature-server-generator exposes the scaffold primary subcommand contract", () => {
  assert.equal(descriptor.kind, "generator");
  assert.equal(descriptor.options?.mode?.validationType, "enum");
  assert.deepEqual(
    descriptor.options?.mode?.allowedValues,
    ["json-rest", "orchestrator", "custom-knex"]
  );
  assert.equal(descriptor.options?.surface?.validationType, "enabled-surface-id");
  assert.equal(descriptor.metadata?.generatorPrimarySubcommand, "scaffold");
  assert.equal(descriptor.metadata?.generatorSubcommands?.scaffold?.createTarget?.pathTemplate, "packages/${option:feature-name|kebab}");
  assert.equal(descriptor.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("feature-name"), true);
  assert.equal(descriptor.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("route-prefix"), true);
  assert.equal(descriptor.metadata?.generatorSubcommands?.scaffold?.optionNames?.includes("force"), true);
});

test("feature-server-generator routes mode-specific files through mutation when clauses", () => {
  const files = descriptor.mutations?.files || [];
  const routesTemplate = files.find((entry) => entry.from === "templates/src/local-package/server/registerRoutes.js");
  const jsonRestRepositoryTemplate = files.find((entry) => entry.from === "templates/src/local-package/server/repositoryJsonRest.js");
  const customKnexRepositoryTemplate = files.find((entry) => entry.from === "templates/src/local-package/server/repositoryCustomKnex.js");
  const providerTemplate = files.find((entry) => entry.from === "templates/src/local-package/server/FeatureProvider.js");
  const actionIdsTemplate = files.find((entry) => entry.from === "templates/src/local-package/server/actionIds.js");

  assert.ok(routesTemplate);
  assert.deepEqual(routesTemplate.when, {
    option: "route-prefix",
    hasText: true
  });

  assert.ok(jsonRestRepositoryTemplate);
  assert.deepEqual(jsonRestRepositoryTemplate.when, {
    option: "mode",
    equals: "json-rest"
  });

  assert.ok(customKnexRepositoryTemplate);
  assert.deepEqual(customKnexRepositoryTemplate.when, {
    option: "mode",
    equals: "custom-knex"
  });

  assert.ok(providerTemplate);
  assert.deepEqual(providerTemplate.templateContext, {
    entrypoint: "src/server/buildTemplateContext.js",
    export: "buildTemplateContext"
  });

  assert.equal(actionIdsTemplate, undefined);
});

test("feature-server-generator scopes persistence dependencies to persistent modes", () => {
  const runtimeDependencies = descriptor.mutations?.dependencies?.runtime || {};

  assert.deepEqual(runtimeDependencies["@jskit-ai/json-rest-api-core"], {
    version: jsonRestApiCorePackage.version,
    when: {
      option: "mode",
      equals: "json-rest"
    }
  });
  assert.deepEqual(runtimeDependencies["@jskit-ai/database-runtime"], {
    version: databaseRuntimePackage.version,
    when: {
      option: "mode",
      notEquals: "orchestrator"
    }
  });
  assert.deepEqual(runtimeDependencies["@jskit-ai/database-runtime-mysql"], {
    version: databaseRuntimeMysqlPackage.version,
    when: {
      option: "mode",
      notEquals: "orchestrator"
    }
  });
  assert.equal(runtimeDependencies["@jskit-ai/kernel"], kernelPackage.version);
  assert.equal(runtimeDependencies["json-rest-schema"], "1.x.x");
});
