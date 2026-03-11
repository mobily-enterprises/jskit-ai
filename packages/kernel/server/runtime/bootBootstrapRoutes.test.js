import assert from "node:assert/strict";
import test from "node:test";
import { createContainer } from "../container/lib/container.js";
import { KERNEL_TOKENS } from "../../shared/support/tokens.js";
import { registerBootstrapPayloadContributor } from "./bootstrapContributors.js";
import { bootBootstrapRoutes, bootstrapQueryValidator } from "./bootBootstrapRoutes.js";

function createReplyDouble() {
  return {
    statusCode: 200,
    payload: null,
    code(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.payload = value;
      return this;
    }
  };
}

test("bootstrapQueryValidator normalizes workspaceSlug", () => {
  assert.deepEqual(bootstrapQueryValidator.normalize({}), {});
  assert.deepEqual(bootstrapQueryValidator.normalize({ workspaceSlug: "  AcMe  " }), {
    workspaceSlug: "acme"
  });
});

test("bootBootstrapRoutes registers GET /api/bootstrap and resolves contributors", async () => {
  const app = createContainer();
  const routes = [];
  const router = {
    register(method, path, route, handler) {
      routes.push({
        method,
        path,
        route,
        handler
      });
    }
  };

  app.instance(KERNEL_TOKENS.HttpRouter, router);
  registerBootstrapPayloadContributor(app, "test.bootstrap.payload", () => ({
    contributorId: "test.bootstrap.payload",
    contribute({ workspaceSlug }) {
      return {
        source: "test",
        workspaceSlug
      };
    }
  }));

  bootBootstrapRoutes(app);

  const bootstrapRoute = routes.find((entry) => entry.method === "GET" && entry.path === "/api/bootstrap");
  assert.ok(bootstrapRoute);
  assert.equal(typeof bootstrapRoute.route.query.normalize, "function");

  const reply = createReplyDouble();
  await bootstrapRoute.handler(
    {
      input: {
        query: {
          workspaceSlug: "acme"
        }
      }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, {
    source: "test",
    workspaceSlug: "acme"
  });
});
