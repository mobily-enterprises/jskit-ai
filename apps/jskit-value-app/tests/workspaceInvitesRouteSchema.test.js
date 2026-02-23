import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { registerApiRoutes } from "../server/fastify/registerApiRoutes.js";
import { buildRoutes as buildWorkspaceRoutes } from "../server/modules/workspace/routes.js";

test("workspace invites route serializes invite workspace payload including color", async () => {
  const controllers = {
    workspace: {
      async listWorkspaceInvites(_request, reply) {
        reply.code(200).send({
          workspace: {
            id: 11,
            slug: "acme",
            name: "Acme",
            color: "#0F6B54",
            avatarUrl: "",
            ownerUserId: 7,
            isPersonal: false
          },
          invites: [
            {
              id: 101,
              workspaceId: 11,
              email: "invitee@example.com",
              roleId: "member",
              status: "pending",
              expiresAt: "2030-01-01T00:00:00.000Z",
              invitedByUserId: 7,
              invitedByDisplayName: "Owner",
              invitedByEmail: "owner@example.com",
              workspace: {
                id: 11,
                slug: "acme",
                name: "Acme",
                color: "#0F6B54",
                avatarUrl: ""
              }
            }
          ],
          roleCatalog: {
            collaborationEnabled: true,
            defaultInviteRole: "member",
            roles: [
              {
                id: "member",
                assignable: true,
                permissions: ["workspace.members.view"]
              }
            ],
            assignableRoleIds: ["member"]
          }
        });
      }
    }
  };
  const routes = buildWorkspaceRoutes(controllers, {
    missingHandler: async (_request, reply) => {
      reply.code(501).send({
        error: "missing"
      });
    }
  });
  const app = Fastify();
  registerApiRoutes(app, {
    controllers,
    routes
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/workspace/invites"
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.invites[0].workspace.color, "#0F6B54");
  await app.close();
});
