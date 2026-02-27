import assert from "node:assert/strict";
import test from "node:test";

import { buildRoutesFromManifest, createRuntimeAssembly, mergeRuntimeBundles } from "../src/shared/runtimeAssembly.js";

test("mergeRuntimeBundles concatenates runtime bundle definitions in order", () => {
  const merged = mergeRuntimeBundles([
    {
      repositoryDefinitions: [{ id: "repoA", create: () => ({}) }],
      runtimeServiceIds: ["serviceA"]
    },
    {
      serviceDefinitions: [{ id: "serviceA", create: () => ({}) }],
      controllerDefinitions: [{ id: "controllerA", create: () => ({}) }]
    }
  ]);

  assert.deepEqual(merged.repositoryDefinitions.map((entry) => entry.id), ["repoA"]);
  assert.deepEqual(merged.serviceDefinitions.map((entry) => entry.id), ["serviceA"]);
  assert.deepEqual(merged.controllerDefinitions.map((entry) => entry.id), ["controllerA"]);
  assert.deepEqual(merged.runtimeServiceIds, ["serviceA"]);
});

test("createRuntimeAssembly supports multi-bundle runtime assembly", () => {
  const runtime = createRuntimeAssembly({
    bundles: [
      {
        repositoryDefinitions: [{ id: "repoA", create: () => ({ ping: () => "pong" }) }],
        serviceDefinitions: [{ id: "serviceA", create: ({ repositories }) => repositories.repoA }],
        runtimeServiceIds: ["serviceA"]
      },
      {
        controllerDefinitions: [{ id: "controllerA", create: ({ services }) => services.serviceA }]
      }
    ]
  });

  assert.equal(runtime.controllers.controllerA.ping(), "pong");
  assert.deepEqual(Object.keys(runtime.runtimeServices), ["serviceA"]);
});

test("buildRoutesFromManifest resolves module options and flattens route arrays", () => {
  const routes = buildRoutesFromManifest({
    controllers: { health: { get: async () => {} } },
    routeConfig: { maxBodyBytes: 2048 },
    definitions: [
      {
        id: "health",
        resolveOptions(routeConfig) {
          return {
            bodyLimit: routeConfig.maxBodyBytes
          };
        },
        buildRoutes(controllers, options) {
          return [
            {
              method: "GET",
              path: "/api/health",
              bodyLimit: options.bodyLimit,
              handler: controllers.health.get
            }
          ];
        }
      }
    ]
  });

  assert.equal(routes.length, 1);
  assert.equal(routes[0].bodyLimit, 2048);
});
