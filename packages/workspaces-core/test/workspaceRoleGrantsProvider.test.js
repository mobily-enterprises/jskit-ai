import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { WorkspaceRoleGrantsProvider } from "../src/server/WorkspaceRoleGrantsProvider.js";

const LabelsFeature = defineFeature({
  id: "test.labels",
  domain: "labels",
  actions: () => ["list", "view", "create", "update", "delete"].map((operation) => ({
    id: `crud.labels.${operation}`,
    kind: operation === "list" || operation === "view" ? "query" : "command",
    channels: ["api"],
    surfaces: ["app"],
    permission: { require: "all", permissions: [`crud.labels.${operation}`] },
    input: { schema: createSchema({}), mode: "replace" },
    execute: async () => null
  }))
});

function memberGrants(permissions) {
  return {
    tenancyMode: "workspaces",
    roleCatalog: {
      workspace: { defaultInviteRole: "member" },
      roles: {
        owner: { permissions: ["*"] },
        member: { assignable: true, permissions }
      }
    }
  };
}

function captureLogger() {
  const warnings = [];
  const ignore = () => {};
  return { warnings, logger: { debug: ignore, info: ignore, error: ignore, warn: (...args) => warnings.push(args) } };
}

function startRuntime({ config, env = { APP_ENV: "test" }, logger = captureLogger().logger, workspacesEnabled = true, routes = [] }) {
  const workspaces = defineProvider({
    id: "test.workspaces",
    provides: { workspaces: "workspaces.core" },
    setup: () => ({ workspaces: { enabled: workspacesEnabled } })
  });
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.config": config,
      "runtime.env": env,
      "runtime.http": { router: { list: () => routes } },
      "runtime.logger": logger
    },
    providers: [EventProvider, ActionProvider, LabelsFeature, workspaces, WorkspaceRoleGrantsProvider]
  });
  return runtime.start();
}

test("in development and test the server refuses to start while a role grants a permission no action requires", async () => {
  await assert.rejects(
    startRuntime({ config: memberGrants(["crud.labels.list", "crud.labels.patch"]), env: { APP_ENV: "test" } }),
    (error) => {
      assert.match(error.message, /Role "member" grants "crud\.labels\.patch", which no action requires; did you mean "crud\.labels\.update"\?/u);
      assert.match(
        error.message,
        /Before removing or renaming a grant, search the application's own code for that permission \(hasPermission\(\)/u,
        "the refusal says to look for the permission in the app's own code before removing the grant"
      );
      return true;
    }
  );
  await assert.rejects(
    startRuntime({ config: memberGrants(["crud.labels.patch"]), env: { APP_ENV: "development", NODE_ENV: "production" } }),
    /crud\.labels\.patch/u,
    "NODE_ENV decides nothing"
  );
});

test("in staging and production the server starts and logs the grant as a warning", async () => {
  for (const APP_ENV of ["staging", "production"]) {
    const { warnings, logger } = captureLogger();
    await startRuntime({ config: memberGrants(["crud.labels.patch"]), env: { APP_ENV, NODE_ENV: "production" }, logger });

    assert.equal(warnings.length, 1, APP_ENV);
    assert.match(String(warnings[0].at(-1)), /Role "member" grants "crud\.labels\.patch", which no action requires; did you mean "crud\.labels\.update"\?/u);
  }
});

test("a role catalogue whose grants each cover a required permission starts quietly", async () => {
  const { warnings, logger } = captureLogger();
  await startRuntime({
    config: memberGrants(["crud.labels.update", "crud.labels.*", "projects.view"]),
    routes: [{ method: "GET", path: "/api/w/:workspaceSlug/projects", permission: "projects.view" }],
    logger
  });
  assert.deepEqual(warnings, []);
});

test("an application without workspaces uses no role catalogue, so nothing is checked", async () => {
  await startRuntime({ config: memberGrants(["crud.labels.patch"]), workspacesEnabled: false });
});
