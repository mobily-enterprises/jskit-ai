import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createSchema } from "json-rest-schema";

import { ActionProvider } from "../actions/actionProvider.js";
import { EventProvider } from "../runtime/EventProvider.js";
import { silentLogger } from "../runtime/logger.js";
import { createCapabilityRuntime, defineProvider } from "../../shared/capabilities/index.js";
import { defineFeature } from "../features/defineFeature.js";
import { createActionRouteScope } from "./lib/actionRouteScope.js";
import { HttpProvider } from "./HttpProvider.js";

// A signed-in route (auth "required" or "own") that names the action it runs (`actionId`) refuses a caller that action
// refuses before anything the request sends is validated or read: its query and path (which Fastify validates), its
// body (which the route's input validates), a file it would read, its middleware and its handler. The action's
// channel, surface and permission are checked in the context the request's action runs in, with the route's params as
// the input context contributors read (#497). A public route's caller is identified, if at all, by the application's
// own hooks or handler wrapper, so its action is authorized where its handler runs it.

const params = { schema: createSchema({ projectId: { type: "string", required: true, pattern: "^[1-9][0-9]*$" } }), mode: "patch" };
const query = { schema: createSchema({ view: { type: "string", required: false, enum: ["all", "open"] } }), mode: "patch" };
const body = { schema: createSchema({ title: { type: "string", required: true, minLength: 1 } }), mode: "create" };

function projectAction(id, { kind = "command", surfaces = ["app"], permission } = {}) {
  return {
    id,
    kind,
    channels: ["api"],
    surfaces,
    permission,
    input: { schema: createSchema({ projectId: { type: "string", required: true }, title: { type: "string", required: false } }), mode: "patch" },
    async execute(input) {
      return { ran: id, input };
    }
  };
}

// The caller a test names in a header, with the permissions of the project its route's path names, as an application's
// context contributors resolve them. `seen` records the input each contribution was asked for.
function projectsApp(t) {
  const app = Fastify();
  t.after(() => app.close());
  // As @fastify/multipart does, the parser leaves a multipart body for the handler to read.
  app.addContentTypeParser("multipart/form-data", (_request, _payload, done) => done(null));
  const seen = [];
  const reached = [];
  const Permissions = defineProvider({
    id: "test.project.permissions",
    requires: { actions: "runtime.actions" },
    setup({ actions }) {
      actions.registerContextContributor({
        id: "test.project.permissions",
        contribute({ input, context }) {
          seen.push({ ...input });
          const request = context.requestMeta?.request;
          const user = String(request?.wrapperUser || request?.headers?.["x-test-user"] || "");
          if (!user) return {};
          return { actor: { id: user }, permissions: user === "editor" && input.projectId === "7" ? ["projects.write"] : [] };
        }
      });
      return {};
    }
  });
  const writer = { require: "all", permissions: ["projects.write"] };
  const Projects = defineFeature({
    id: "test.projects",
    domain: "projects",
    requires: { http: "runtime.http" },
    setup({ http }) {
      const note = (name) => async () => {
        reached.push(name);
      };
      const signedIn = { auth: "required", surface: "app" };
      http.router.register("POST", "/api/projects/:projectId/tasks", {
        ...signedIn,
        actionId: "projects.task.add",
        params,
        query,
        body,
        middleware: [note("middleware")]
      }, async function addTask(request, reply) {
        reached.push("handler");
        reply.send(await request.executeAction({ actionId: "projects.task.add", input: { ...request.input.params, ...request.input.body } }));
      });
      http.router.register("POST", "/api/projects/:projectId/exports", {
        ...signedIn,
        actionId: "projects.export.stream",
        params,
        body
      }, async function exportProject(request, reply) {
        reached.push("handler");
        reply.send(await request.executeAction({ actionId: "projects.export.stream", input: request.input.params }));
      });
      http.router.register("POST", "/api/projects/:projectId/files", {
        ...signedIn,
        actionId: "projects.file.attach",
        params
      }, async function attachFile(request, reply) {
        // An upload route reads its file here; a refused caller's request never reaches it.
        reached.push("file read");
        reply.send(await request.executeAction({ actionId: "projects.file.attach", input: request.input.params }));
      });
      http.router.register("POST", "/api/projects/:projectId/archive", {
        ...signedIn,
        actionId: "projects.archive",
        params,
        body
      }, async function archiveProject(request, reply) {
        reached.push("handler");
        reply.send(await request.executeAction({ actionId: "projects.archive", input: request.input.params }));
      });
      http.router.register("POST", "/api/projects/:projectId/signals", {
        ...signedIn,
        actionId: "projects.signal",
        params,
        body
      }, async function signalProject(request, reply) {
        reached.push("handler");
        reply.send(await request.executeAction({ actionId: "projects.signal", input: request.input.params }));
      });
      createActionRouteScope(http, { routeBase: "/projects/:projectId", surface: "app" }).actionRoute("POST", "/notes", {
        auth: "required",
        actionId: "projects.task.add",
        params,
        body,
        buildInput: (request) => (reached.push("buildInput"), { ...request.input.params, ...request.input.body })
      });
      // An application whose handler wrapper identifies the caller and answers its refusals, on routes public to the
      // auth policy, as Vibe64's route scopes do.
      const wrapped = createActionRouteScope(http, {
        routeBase: "/projects/:projectId",
        surface: "app",
        wrapHandler: (handler) => async function wrappedRoute(request, reply) {
          request.wrapperUser = String(request.headers["x-wrapper-user"] || "");
          try {
            return await handler(request, reply);
          } catch (error) {
            return reply.code(error.status).send({ wrapped: error.code });
          }
        }
      });
      wrapped.actionRoute("POST", "/wrapped-notes", {
        auth: "public",
        actionId: "projects.task.add",
        params,
        body,
        buildInput: (request) => ({ ...request.input.params, ...request.input.body })
      });
      return {};
    },
    actions: [
      projectAction("projects.task.add", { permission: writer }),
      projectAction("projects.export.stream", { kind: "stream", permission: writer }),
      projectAction("projects.file.attach", { permission: writer }),
      projectAction("projects.archive", { surfaces: ["console"], permission: { require: "none" } }),
      projectAction("projects.signal", { permission: { require: "authenticated" } })
    ]
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger, "runtime.fastify": app },
    providers: [EventProvider, ActionProvider, HttpProvider, Permissions, Projects]
  });
  const send = (user, url, payload, headers = {}) => app.inject({
    method: "POST",
    url,
    headers: { ...headers, ...(user ? { "x-test-user": user } : {}) },
    payload
  });
  return { start: () => runtime.start(), stop: () => runtime.shutdown(), send, seen, reached };
}

function assertRefused(response, statusCode, code) {
  assert.equal(response.statusCode, statusCode, response.body);
  const payload = response.json();
  assert.equal(payload.code, code, response.body);
  assert.equal(Object.hasOwn(payload, "fieldErrors"), false, response.body);
}

test("a route's action refuses the caller before the route validates its query, path or body", async (t) => {
  const projects = projectsApp(t);
  await projects.start();
  t.after(projects.stop);

  assertRefused(await projects.send("viewer", "/api/projects/7/tasks?view=nowhere", { title: "" }), 403, "ACTION_PERMISSION_DENIED");
  assertRefused(await projects.send("viewer", "/api/projects/007/tasks", { title: "" }), 403, "ACTION_PERMISSION_DENIED");
  assertRefused(await projects.send("viewer", "/api/projects/7/tasks", { title: "" }), 403, "ACTION_PERMISSION_DENIED");
  assertRefused(await projects.send("viewer", "/api/projects/7/notes", { title: "" }), 403, "ACTION_PERMISSION_DENIED");
  assertRefused(await projects.send("viewer", "/api/projects/7/exports", { title: "" }), 403, "ACTION_PERMISSION_DENIED");
  const file = ["--b", 'Content-Disposition: form-data; name="file"; filename="a.txt"', "", "a file", "--b--", ""].join("\r\n");
  assertRefused(
    await projects.send("viewer", "/api/projects/7/files", file, { "content-type": "multipart/form-data; boundary=b" }),
    403, "ACTION_PERMISSION_DENIED"
  );
  // The permission is the project's the path names: an editor of project 7 holds none in project 8.
  assertRefused(await projects.send("editor", "/api/projects/8/tasks", { title: "" }), 403, "ACTION_PERMISSION_DENIED");
  // The action's surface and authentication are its own too.
  assertRefused(await projects.send("editor", "/api/projects/7/archive", { title: "" }), 403, "ACTION_SURFACE_FORBIDDEN");
  assertRefused(await projects.send(null, "/api/projects/7/signals", { title: "" }), 401, "ACTION_AUTHENTICATION_REQUIRED");
  assert.deepEqual(projects.reached, [], "nothing of a refused request was read, transformed or handled");
  assert.ok(projects.seen.every((input) => Object.keys(input).join() === "projectId"), JSON.stringify(projects.seen));
});

test("a caller the route's action allows is answered with the route's field errors, then its action's answer", async (t) => {
  const projects = projectsApp(t);
  await projects.start();
  t.after(projects.stop);

  const badQuery = await projects.send("editor", "/api/projects/7/tasks?view=nowhere", { title: "Plan" });
  assert.equal(badQuery.statusCode, 400, badQuery.body);
  assert.ok(badQuery.json().fieldErrors.view, badQuery.body);
  const badBody = await projects.send("editor", "/api/projects/7/notes", { title: "" });
  assert.equal(badBody.statusCode, 400, badBody.body);
  assert.ok(badBody.json().fieldErrors.title, badBody.body);

  const added = await projects.send("editor", "/api/projects/7/tasks?view=open", { title: "Plan" });
  assert.equal(added.statusCode, 200, added.body);
  assert.deepEqual(added.json(), { ran: "projects.task.add", input: { projectId: "7", title: "Plan" } });
  assert.deepEqual(projects.reached.slice(-2), ["middleware", "handler"]);
  const noted = await projects.send("editor", "/api/projects/7/notes", { title: "Plan" });
  assert.equal(noted.statusCode, 200, noted.body);
  assert.deepEqual(noted.json(), { ran: "projects.task.add", input: { projectId: "7", title: "Plan" } });
  const exported = await projects.send("editor", "/api/projects/7/exports", { title: "Plan" });
  assert.equal(exported.statusCode, 200, exported.body);
  assert.deepEqual(exported.json(), { ran: "projects.export.stream", input: { projectId: "7" } });
});

test("a public route's action is authorized where its handler runs it, inside the application's own handler wrapper", async (t) => {
  const projects = projectsApp(t);
  await projects.start();
  t.after(projects.stop);

  const added = await projects.send(null, "/api/projects/7/wrapped-notes", { title: "Plan" }, { "x-wrapper-user": "editor" });
  assert.equal(added.statusCode, 200, added.body);
  assert.deepEqual(added.json(), { ran: "projects.task.add", input: { projectId: "7", title: "Plan" } });
  const refused = await projects.send(null, "/api/projects/7/wrapped-notes", { title: "Plan" }, { "x-wrapper-user": "viewer" });
  assert.equal(refused.statusCode, 403, refused.body);
  assert.deepEqual(refused.json(), { wrapped: "ACTION_PERMISSION_DENIED" });
});
