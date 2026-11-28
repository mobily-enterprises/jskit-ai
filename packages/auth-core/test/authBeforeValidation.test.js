import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createSchema } from "json-rest-schema";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createActionRouteScope, HttpProvider } from "@jskit-ai/kernel/server/http";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { AuthExtensionsProvider } from "../src/server/providers/AuthExtensionsProvider.js";
import { AuthPolicyProvider } from "../src/server/providers/AuthPolicyProvider.js";

// Authorization is decided before validation answers (#497): a signed-out caller is told to sign in, and a signed-in
// caller without the permission of the action a route runs is refused, whatever query, path or body they send, and
// neither answer says what the route accepts. A caller who may use the route still gets its field errors.

const slug = { schema: createSchema({ workspaceSlug: { type: "string", required: true, pattern: "^[a-z]+$" } }), mode: "patch" };
const messageParams = {
  schema: createSchema({
    workspaceSlug: { type: "string", required: true, pattern: "^[a-z]+$" },
    messageId: { type: "string", required: true, pattern: "^[1-9][0-9]*$" }
  }),
  mode: "patch"
};
const viewQuery = { schema: createSchema({ view: { type: "string", required: false, enum: ["all", "unread"] } }), mode: "patch" };
const replyBody = { schema: createSchema({ text: { type: "string", required: true, minLength: 1 } }), mode: "create" };
const workspaceInput = { workspaceSlug: { type: "string", required: true } };

// Staff of the workspace hold the inbox permissions; a customer of it is signed in and holds none.
const PERMISSIONS = Object.freeze({ staff: ["inbox.read", "inbox.reply"], customer: [] });

function inboxAction(id, permissions, input = {}) {
  return {
    id,
    kind: "command",
    channels: ["api"],
    surfaces: ["app"],
    permission: { require: "all", permissions },
    input: { schema: createSchema({ ...workspaceInput, ...input }), mode: "patch" },
    async execute(actionInput) {
      return { ran: id, input: actionInput };
    }
  };
}

// The inbox as an application serves it: plain routes that name the action they run, and an action route.
const InboxFeature = defineFeature({
  id: "test.inbox",
  domain: "inbox",
  requires: { http: "runtime.http" },
  setup({ http }) {
    const routeOptions = { auth: "required", surface: "app", csrfProtection: false };
    http.router.register("GET", "/api/w/:workspaceSlug/inbox/messages", {
      ...routeOptions,
      actionId: "inbox.messages.list",
      params: slug,
      query: viewQuery
    }, async function listMessages(request, reply) {
      reply.send(await request.executeAction({
        actionId: "inbox.messages.list",
        input: { workspaceSlug: request.input.params.workspaceSlug, ...request.input.query }
      }));
    });
    http.router.register("GET", "/api/w/:workspaceSlug/inbox/messages/:messageId", {
      ...routeOptions,
      actionId: "inbox.message.read",
      params: messageParams
    }, async function readMessage(request, reply) {
      reply.send(await request.executeAction({ actionId: "inbox.message.read", input: request.input.params }));
    });
    http.router.register("POST", "/api/w/:workspaceSlug/inbox/replies", {
      ...routeOptions,
      actionId: "inbox.reply",
      params: slug,
      body: replyBody
    }, async function sendReply(request, reply) {
      reply.send(await request.executeAction({
        actionId: "inbox.reply",
        input: { workspaceSlug: request.input.params.workspaceSlug, ...request.input.body }
      }));
    });
    createActionRouteScope(http, { routeBase: "/w/:workspaceSlug", surface: "app" }).actionRoute("POST", "/inbox/notes", {
      ...routeOptions,
      actionId: "inbox.note.add",
      params: slug,
      body: replyBody,
      buildInput: (request) => ({ workspaceSlug: request.input.params.workspaceSlug, ...request.input.body })
    });
    return {};
  },
  actions: [
    inboxAction("inbox.messages.list", ["inbox.read"], { view: { type: "string", required: false } }),
    inboxAction("inbox.message.read", ["inbox.read"], { messageId: { type: "string", required: true } }),
    inboxAction("inbox.reply", ["inbox.reply"], { text: { type: "string", required: true } }),
    inboxAction("inbox.note.add", ["inbox.reply"], { text: { type: "string", required: true } })
  ]
});

// The signed-in user is the one a test names in a header, as a session would name them.
const HeaderAuthService = defineProvider({
  id: "test.auth.service",
  provides: { service: "auth.service" },
  setup() {
    return {
      service: {
        async authenticateRequest(request) {
          const id = String(request.headers["x-test-user"] || "");
          return id
            ? { authenticated: true, actor: { id }, transientFailure: false }
            : { authenticated: false, actor: null, transientFailure: false };
        }
      }
    };
  }
});

// The workspace's permissions for the action's user, from the workspace its input names, as the workspaces context
// contributor resolves them.
const WorkspacePermissions = defineProvider({
  id: "test.workspace.permissions",
  requires: { actions: "runtime.actions" },
  setup({ actions }) {
    actions.registerContextContributor({
      id: "test.workspace.permissions",
      contribute({ input, context }) {
        const user = context.requestMeta?.request?.user;
        return input.workspaceSlug === "acme" && user ? { permissions: PERMISSIONS[user.id] || [] } : {};
      }
    });
    return {};
  }
});

async function inboxApp(t) {
  const app = Fastify();
  t.after(() => app.close());
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.env": { APP_ENV: "test" }, "runtime.fastify": app, "runtime.logger": silentLogger },
    providers: [
      EventProvider,
      ActionProvider,
      HttpProvider,
      AuthExtensionsProvider,
      HeaderAuthService,
      AuthPolicyProvider,
      WorkspacePermissions,
      InboxFeature
    ]
  });
  await runtime.start();
  t.after(() => runtime.shutdown());
  const send = (user, method, url, payload) => app.inject({
    method,
    url,
    headers: user ? { "x-test-user": user } : {},
    ...(payload === undefined ? {} : { payload })
  });
  return { send };
}

/** A refusal that tells the caller nothing about what the route accepts. */
function assertRefusedWithoutFieldDetails(response, statusCode, code, words) {
  assert.equal(response.statusCode, statusCode, response.body);
  const payload = response.json();
  assert.equal(payload.code, code, response.body);
  assert.equal(Object.hasOwn(payload, "fieldErrors"), false, response.body);
  assert.equal(Object.hasOwn(payload, "details"), false, response.body);
  for (const word of words) {
    assert.equal(response.body.includes(word), false, `${word} in ${response.body}`);
  }
}

test("a signed-out caller with a query or path the route refuses is asked to sign in, not told what it accepts", async (t) => {
  const { send } = await inboxApp(t);

  assertRefusedWithoutFieldDetails(
    await send(null, "GET", "/api/w/acme/inbox/messages?view=nowhere"),
    401, "auth.session.required", ["view", "unread"]
  );
  assertRefusedWithoutFieldDetails(
    await send(null, "GET", "/api/w/acme/inbox/messages/007"),
    401, "auth.session.required", ["messageId", "pattern"]
  );
  assertRefusedWithoutFieldDetails(
    await send(null, "GET", "/api/w/ACME-1/inbox/messages"),
    401, "auth.session.required", ["workspaceSlug", "pattern"]
  );
  assertRefusedWithoutFieldDetails(
    await send(null, "POST", "/api/w/acme/inbox/replies", { text: "" }),
    401, "auth.session.required", ["text"]
  );
});

test("a signed-in caller without the permission of the action a route runs is refused, whatever they send", async (t) => {
  const { send } = await inboxApp(t);

  assertRefusedWithoutFieldDetails(
    await send("customer", "POST", "/api/w/acme/inbox/replies", { text: "" }),
    403, "ACTION_PERMISSION_DENIED", ["text", "minLength"]
  );
  assertRefusedWithoutFieldDetails(
    await send("customer", "POST", "/api/w/acme/inbox/replies", ["not", "an", "object"]),
    403, "ACTION_PERMISSION_DENIED", ["must be object"]
  );
  assertRefusedWithoutFieldDetails(
    await send("customer", "POST", "/api/w/acme/inbox/notes", { text: "" }),
    403, "ACTION_PERMISSION_DENIED", ["text", "minLength"]
  );
  assertRefusedWithoutFieldDetails(
    await send("customer", "GET", "/api/w/acme/inbox/messages?view=nowhere"),
    403, "ACTION_PERMISSION_DENIED", ["view", "unread"]
  );
  assertRefusedWithoutFieldDetails(
    await send("customer", "GET", "/api/w/acme/inbox/messages/007"),
    403, "ACTION_PERMISSION_DENIED", ["messageId", "pattern"]
  );
  assertRefusedWithoutFieldDetails(
    await send("customer", "POST", "/api/w/acme/inbox/replies", { text: "Hello" }),
    403, "ACTION_PERMISSION_DENIED", []
  );
});

test("a caller the route's action allows still gets the field errors of what they send, and its answer", async (t) => {
  const { send } = await inboxApp(t);

  const badQuery = await send("staff", "GET", "/api/w/acme/inbox/messages?view=nowhere");
  assert.equal(badQuery.statusCode, 400, badQuery.body);
  assert.ok(badQuery.json().fieldErrors.view, badQuery.body);
  const badPath = await send("staff", "GET", "/api/w/acme/inbox/messages/007");
  assert.equal(badPath.statusCode, 400, badPath.body);
  assert.ok(badPath.json().fieldErrors.messageId, badPath.body);
  for (const path of ["replies", "notes"]) {
    const badBody = await send("staff", "POST", `/api/w/acme/inbox/${path}`, { text: "" });
    assert.equal(badBody.statusCode, 400, badBody.body);
    assert.ok(badBody.json().fieldErrors.text, badBody.body);
  }

  const listed = await send("staff", "GET", "/api/w/acme/inbox/messages?view=unread");
  assert.equal(listed.statusCode, 200, listed.body);
  assert.deepEqual(listed.json(), { ran: "inbox.messages.list", input: { workspaceSlug: "acme", view: "unread" } });
  const replied = await send("staff", "POST", "/api/w/acme/inbox/replies", { text: "Hello" });
  assert.equal(replied.statusCode, 200, replied.body);
  assert.deepEqual(replied.json(), { ran: "inbox.reply", input: { workspaceSlug: "acme", text: "Hello" } });
  const noted = await send("staff", "POST", "/api/w/acme/inbox/notes", { text: "Hello" });
  assert.equal(noted.statusCode, 200, noted.body);
  assert.deepEqual(noted.json(), { ran: "inbox.note.add", input: { workspaceSlug: "acme", text: "Hello" } });
});
