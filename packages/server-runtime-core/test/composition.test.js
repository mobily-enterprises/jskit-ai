import assert from "node:assert/strict";
import test from "node:test";

import {
  createControllerRegistry,
  createRepositoryRegistry,
  createRuntimeComposition,
  createServiceRegistry,
  selectRuntimeServices
} from "../src/server/composition.js";

test("createRepositoryRegistry and createServiceRegistry assemble definitions in order", () => {
  const repositories = createRepositoryRegistry([
    {
      id: "usersRepository",
      create() {
        return {
          list: () => ["alice"]
        };
      }
    }
  ]);

  const services = createServiceRegistry({
    definitions: [
      {
        id: "usersService",
        create({ repositories: deps }) {
          return {
            listUsers: () => deps.usersRepository.list()
          };
        }
      }
    ],
    dependencies: {
      repositories
    }
  });

  assert.deepEqual(services.usersService.listUsers(), ["alice"]);
});

test("createControllerRegistry injects services into controller factories", () => {
  const services = {
    healthService: {
      ping: () => "ok"
    }
  };

  const controllers = createControllerRegistry({
    definitions: [
      {
        id: "health",
        create({ services: deps }) {
          return {
            get: () => deps.healthService.ping()
          };
        }
      }
    ],
    services
  });

  assert.equal(controllers.health.get(), "ok");
});

test("selectRuntimeServices returns only requested service exports", () => {
  const selected = selectRuntimeServices(
    {
      authService: { id: "auth" },
      chatService: { id: "chat" },
      workspaceService: { id: "workspace" }
    },
    ["authService", "workspaceService"]
  );

  assert.deepEqual(Object.keys(selected), ["authService", "workspaceService"]);
});

test("registry helpers throw on duplicate ids and missing selected runtime services", () => {
  assert.throws(
    () =>
      createRepositoryRegistry([
        {
          id: "usersRepository",
          create: () => ({})
        },
        {
          id: "usersRepository",
          create: () => ({})
        }
      ]),
    /duplicated/
  );

  assert.throws(
    () =>
      selectRuntimeServices(
        {
          authService: {}
        },
        ["authService", "billingService"]
      ),
    /billingService/
  );
});

test("createRuntimeComposition builds repositories, services, controllers, and runtime exports", () => {
  const composition = createRuntimeComposition({
    repositoryDefinitions: [
      {
        id: "projectsRepository",
        create: () => ({
          list: () => ["demo-project"]
        })
      }
    ],
    serviceDefinitions: [
      {
        id: "projectsService",
        create: ({ repositories }) => ({
          list: () => repositories.projectsRepository.list()
        })
      }
    ],
    controllerDefinitions: [
      {
        id: "projects",
        create: ({ services }) => ({
          list: () => services.projectsService.list()
        })
      }
    ],
    runtimeServiceIds: ["projectsService"]
  });

  assert.deepEqual(composition.controllers.projects.list(), ["demo-project"]);
  assert.deepEqual(Object.keys(composition.runtimeServices), ["projectsService"]);
});
