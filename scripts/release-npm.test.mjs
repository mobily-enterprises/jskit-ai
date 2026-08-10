import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  STAGING_TAG,
  topologicalPublishOrder,
  updateDescriptorTextForPackage
} from "./release-npm.mjs";

test("release descriptor updates cover direct and conditional JSKIT dependency versions", () => {
  const source = `
export default {
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/kernel": "0.1.1",
        '@jskit-ai/kernel': '0.1.2',
        "@jskit-ai/database-runtime": {
          version: "0.1.3",
          when: { option: "mode", notEquals: "orchestrator" }
        },
        '@jskit-ai/database-runtime': {
          'version': '0.1.4',
          when: { option: 'mode', equals: 'json-rest' }
        }
      }
    }
  }
};
`;

  const kernelUpdated = updateDescriptorTextForPackage(
    source,
    "@jskit-ai/kernel",
    "0.1.120"
  );
  const fullyUpdated = updateDescriptorTextForPackage(
    kernelUpdated,
    "@jskit-ai/database-runtime",
    "0.1.119"
  );

  assert.match(fullyUpdated, /"@jskit-ai\/kernel": "0\.1\.120"/u);
  assert.match(fullyUpdated, /'@jskit-ai\/kernel': '0\.1\.120'/u);
  assert.equal(
    fullyUpdated.match(/(?:"version"|'version'|version):?\s*["']0\.1\.119["']/gu)?.length,
    2
  );
  assert.match(fullyUpdated, /notEquals: "orchestrator"/u);
  assert.match(fullyUpdated, /equals: 'json-rest'/u);
});

test("release descriptor updates leave other package versions unchanged", () => {
  const source = `
export default {
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/kernel": "0.1.119",
        "@jskit-ai/http-runtime": {
          version: "0.1.117",
          when: { option: "transport", equals: "http" }
        }
      }
    }
  }
};
`;

  const updated = updateDescriptorTextForPackage(source, "@jskit-ai/kernel", "0.1.120");

  assert.match(updated, /"@jskit-ai\/kernel": "0\.1\.120"/u);
  assert.match(updated, /version: "0\.1\.117"/u);
});

test("release publication reserves a non-consumer staging tag", () => {
  assert.equal(STAGING_TAG, "jskit-staged");
  assert.notEqual(STAGING_TAG, "latest");
});

test("release promotion order keeps exact dependencies before dependants", () => {
  const records = [
    {
      name: "@jskit-ai/create-app",
      packageJsonLocalDeps: new Set(["@jskit-ai/jskit-cli"])
    },
    {
      name: "@jskit-ai/jskit-cli",
      packageJsonLocalDeps: new Set(["@jskit-ai/jskit-catalog"])
    },
    {
      name: "@jskit-ai/jskit-catalog",
      packageJsonLocalDeps: new Set()
    }
  ];
  const publishSet = new Set(records.map((record) => record.name));

  assert.deepEqual(topologicalPublishOrder(records, publishSet), [
    "@jskit-ai/jskit-catalog",
    "@jskit-ai/jskit-cli",
    "@jskit-ai/create-app"
  ]);
});

async function readWorkspacePackageJson(relativePath) {
  return JSON.parse(
    await readFile(new URL(`../${relativePath}/package.json`, import.meta.url), "utf8")
  );
}

test("prepared CRUD, calendar-date, and toolchain manifests pin one exact dependency graph", async () => {
  const [
    authCore,
    crudCore,
    crudServerGenerator,
    crudUiGenerator,
    databaseRuntime,
    databaseRuntimeMysql,
    databaseRuntimePostgres,
    featureServerGenerator,
    httpRuntime,
    jsonRestApiCore,
    usersCore,
    usersWeb,
    catalog,
    cli,
    createApp
  ] = await Promise.all([
    readWorkspacePackageJson("packages/auth-core"),
    readWorkspacePackageJson("packages/crud-core"),
    readWorkspacePackageJson("packages/crud-server-generator"),
    readWorkspacePackageJson("packages/crud-ui-generator"),
    readWorkspacePackageJson("packages/database-runtime"),
    readWorkspacePackageJson("packages/database-runtime-mysql"),
    readWorkspacePackageJson("packages/database-runtime-postgres"),
    readWorkspacePackageJson("packages/feature-server-generator"),
    readWorkspacePackageJson("packages/http-runtime"),
    readWorkspacePackageJson("packages/json-rest-api-core"),
    readWorkspacePackageJson("packages/users-core"),
    readWorkspacePackageJson("packages/users-web"),
    readWorkspacePackageJson("tooling/jskit-catalog"),
    readWorkspacePackageJson("tooling/jskit-cli"),
    readWorkspacePackageJson("tooling/create-app")
  ]);
  const createAppDescriptor = (
    await import(new URL("../tooling/create-app/package.descriptor.mjs", import.meta.url))
  ).default;
  const crudServerGeneratorDescriptor = (
    await import(new URL("../packages/crud-server-generator/package.descriptor.mjs", import.meta.url))
  ).default;
  const featureServerGeneratorDescriptor = (
    await import(new URL("../packages/feature-server-generator/package.descriptor.mjs", import.meta.url))
  ).default;
  const usersCoreDescriptor = (
    await import(new URL("../packages/users-core/package.descriptor.mjs", import.meta.url))
  ).default;
  const usersWebDescriptor = (
    await import(new URL("../packages/users-web/package.descriptor.mjs", import.meta.url))
  ).default;

  assert.equal(authCore.version, "0.1.145");
  assert.equal(httpRuntime.version, "0.1.145");
  assert.equal(usersCore.version, "0.1.160");
  assert.equal(usersWeb.version, "0.1.164");
  assert.equal(usersWeb.dependencies["@jskit-ai/http-runtime"], httpRuntime.version);
  assert.equal(usersWeb.dependencies["@jskit-ai/users-core"], usersCore.version);
  assert.equal(crudCore.version, "0.1.157");
  assert.equal(databaseRuntime.version, "0.1.146");
  assert.equal(databaseRuntimeMysql.version, "0.1.145");
  assert.equal(databaseRuntimeMysql.dependencies["@jskit-ai/database-runtime"], databaseRuntime.version);
  assert.equal(databaseRuntimePostgres.version, "0.1.144");
  assert.equal(databaseRuntimePostgres.dependencies["@jskit-ai/database-runtime"], databaseRuntime.version);
  assert.equal(jsonRestApiCore.version, "0.1.91");
  assert.equal(usersCore.dependencies["@jskit-ai/auth-core"], authCore.version);
  assert.equal(usersCore.dependencies["@jskit-ai/database-runtime"], databaseRuntime.version);
  assert.equal(usersCore.dependencies["@jskit-ai/http-runtime"], httpRuntime.version);
  assert.equal(usersCore.dependencies["@jskit-ai/json-rest-api-core"], jsonRestApiCore.version);
  assert.equal(crudCore.dependencies["@jskit-ai/database-runtime"], databaseRuntime.version);
  assert.equal(crudCore.dependencies["@jskit-ai/http-runtime"], httpRuntime.version);
  assert.equal(crudCore.dependencies["@jskit-ai/users-core"], usersCore.version);
  assert.equal(crudCore.dependencies["@jskit-ai/users-web"], usersWeb.version);
  assert.equal(
    usersCoreDescriptor.mutations.dependencies.runtime["@jskit-ai/crud-core"],
    crudCore.version
  );
  assert.equal(
    usersWebDescriptor.mutations.dependencies.runtime["@jskit-ai/users-core"],
    usersCore.version
  );
  assert.equal(crudServerGenerator.version, "0.1.159");
  assert.equal(crudServerGenerator.dependencies["@jskit-ai/crud-core"], crudCore.version);
  assert.equal(crudServerGenerator.dependencies["@jskit-ai/database-runtime"], databaseRuntime.version);
  assert.equal(crudServerGenerator.dependencies["@jskit-ai/http-runtime"], httpRuntime.version);
  assert.equal(crudServerGenerator.dependencies["@jskit-ai/json-rest-api-core"], jsonRestApiCore.version);
  assert.equal(
    crudServerGeneratorDescriptor.mutations.dependencies.runtime["@jskit-ai/auth-core"],
    authCore.version
  );
  assert.equal(
    crudServerGeneratorDescriptor.mutations.dependencies.runtime["@jskit-ai/database-runtime"],
    databaseRuntime.version
  );
  assert.equal(
    crudServerGeneratorDescriptor.mutations.dependencies.runtime["@jskit-ai/json-rest-api-core"],
    jsonRestApiCore.version
  );
  assert.equal(crudUiGenerator.version, "0.1.130");
  assert.equal(crudUiGenerator.dependencies["@jskit-ai/crud-core"], crudCore.version);
  assert.equal(featureServerGenerator.version, "0.1.89");
  assert.equal(featureServerGeneratorDescriptor.version, featureServerGenerator.version);
  assert.equal(
    featureServerGeneratorDescriptor.mutations.dependencies.runtime["@jskit-ai/database-runtime"].version,
    databaseRuntime.version
  );
  assert.equal(
    featureServerGeneratorDescriptor.mutations.dependencies.runtime["@jskit-ai/database-runtime-mysql"].version,
    databaseRuntimeMysql.version
  );
  assert.equal(
    featureServerGeneratorDescriptor.mutations.dependencies.runtime["@jskit-ai/json-rest-api-core"].version,
    jsonRestApiCore.version
  );

  assert.equal(catalog.version, "0.1.168");
  assert.equal(cli.version, "0.2.174");
  assert.equal(cli.dependencies["@jskit-ai/jskit-catalog"], catalog.version);
  assert.equal(createApp.version, "0.1.166");
  assert.equal(createAppDescriptor.version, createApp.version);
  assert.equal(createApp.dependencies["@jskit-ai/jskit-cli"], cli.version);
});
