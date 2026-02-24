import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerApiRoutes } from "../server/fastify/registerApiRoutes.js";

function createNoopReply() {
  return {
    code() {
      return this;
    },
    send() {
      return this;
    }
  };
}

function buildControllers({ onListProjects } = {}) {
  const noop = async (_request, reply) => {
    const nextReply = reply || createNoopReply();
    nextReply.code(200).send({ ok: true });
  };

  const fallbackController = new Proxy(noop, {
    get() {
      return fallbackController;
    }
  });

  return new Proxy(
    {
      auth: {
        register: noop,
        login: noop,
        requestOtpLogin: noop,
        verifyOtpLogin: noop,
        oauthStart: noop,
        oauthComplete: noop,
        requestPasswordReset: noop,
        completePasswordRecovery: noop,
        resetPassword: noop,
        logout: noop,
        session: noop
      },
      settings: {
        get: noop,
        updateProfile: noop,
        uploadAvatar: noop,
        deleteAvatar: noop,
        updatePreferences: noop,
        updateNotifications: noop,
        updateChat: noop,
        changePassword: noop,
        setPasswordMethodEnabled: noop,
        startOAuthProviderLink: noop,
        unlinkOAuthProvider: noop,
        logoutOtherSessions: noop
      },
      history: {
        list: noop
      },
      workspace: {},
      projects: {
        async list(request, reply) {
          if (typeof onListProjects === "function") {
            await onListProjects(request);
          }

          reply.code(200).send({
            entries: [],
            page: 1,
            pageSize: 10,
            total: 0,
            totalPages: 1
          });
        },
        async get(_request, reply) {
          reply.code(200).send({
            project: {
              id: 1,
              workspaceId: 1,
              name: "Project",
              status: "draft",
              owner: "",
              notes: "",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z"
            }
          });
        },
        async create(_request, reply) {
          reply.code(200).send({
            project: {
              id: 1,
              workspaceId: 1,
              name: "Project",
              status: "draft",
              owner: "",
              notes: "",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z"
            }
          });
        },
        async update(_request, reply) {
          reply.code(200).send({
            project: {
              id: 1,
              workspaceId: 1,
              name: "Project",
              status: "active",
              owner: "",
              notes: "",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z"
            }
          });
        },
        async replace(_request, reply) {
          reply.code(200).send({
            project: {
              id: 1,
              workspaceId: 1,
              name: "Project replace",
              status: "active",
              owner: "",
              notes: "",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z"
            }
          });
        }
      }
    },
    {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }
        return fallbackController;
      }
    }
  );
}

test("workspace projects route accepts page and pageSize query", async () => {
  let capturedQuery = null;
  const app = Fastify();
  registerApiRoutes(app, {
    controllers: buildControllers({
      onListProjects(request) {
        capturedQuery = request.query;
      }
    })
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/workspace/projects?page=2&pageSize=25"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(capturedQuery.page, 2);
  assert.equal(capturedQuery.pageSize, 25);
  await app.close();
});

test("workspace projects route rejects invalid create payload", async () => {
  const app = Fastify();
  registerApiRoutes(app, {
    controllers: buildControllers()
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/workspace/projects",
    payload: {
      name: "Demo",
      status: "invalid"
    }
  });

  assert.equal(response.statusCode, 400);
  await app.close();
});

test("workspace projects route supports put replace payload", async () => {
  const app = Fastify();
  registerApiRoutes(app, {
    controllers: buildControllers()
  });

  const response = await app.inject({
    method: "PUT",
    url: "/api/v1/workspace/projects/1",
    payload: {
      name: "Demo",
      status: "draft"
    }
  });

  assert.equal(response.statusCode, 200);
  await app.close();
});
