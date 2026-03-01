import assert from "node:assert/strict";
import test from "node:test";
import { createRouter, joinPath } from "../src/shared/router.js";

function noop() {}

test("joinPath composes deterministic paths", () => {
  assert.equal(joinPath("/api", "/users"), "/api/users");
  assert.equal(joinPath("", "/users"), "/users");
});

test("router group merges prefix and middleware", () => {
  const events = [];
  const m1 = async () => events.push("m1");
  const m2 = async () => events.push("m2");

  const router = createRouter();
  router.group({ prefix: "/api", middleware: [m1] }, (group) => {
    group.get("/users", { middleware: [m2] }, noop);
  });

  const routes = router.list();
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, "/api/users");
  assert.equal(routes[0].middleware.length, 2);
  assert.equal(routes[0].middleware[0], m1);
  assert.equal(routes[0].middleware[1], m2);
});

test("apiResource generates expected endpoints", () => {
  const controller = {
    index: noop,
    store: noop,
    show: noop,
    update: noop,
    destroy: noop
  };

  const router = createRouter();
  router.apiResource("projects", controller);

  const routes = router.list().map((route) => `${route.method} ${route.path}`);
  assert.deepEqual(routes, [
    "GET /projects",
    "POST /projects",
    "GET /projects/:id",
    "PUT /projects/:id",
    "DELETE /projects/:id"
  ]);
});
