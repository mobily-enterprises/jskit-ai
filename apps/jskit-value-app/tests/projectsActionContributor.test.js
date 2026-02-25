import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_IDS } from "../shared/actionIds.js";
import { createProjectsActionContributor } from "../server/runtime/actions/contributors/projects.contributor.js";

function getAction(contributor, actionId) {
  return contributor.actions.find((action) => action.id === actionId);
}

function createProjectsServiceDouble() {
  return {
    async list() {
      return {
        entries: [],
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1
      };
    },
    async get(_workspace, projectId) {
      return {
        project: {
          id: Number(projectId),
          status: "draft"
        }
      };
    },
    async create(_workspace, payload) {
      return {
        project: {
          id: Number(payload?.id || 101),
          name: String(payload?.name || "Untitled")
        }
      };
    },
    async update(_workspace, projectId) {
      return {
        project: {
          id: Number(projectId),
          status: "active"
        }
      };
    },
    async replace(_workspace, projectId) {
      return {
        project: {
          id: Number(projectId),
          status: "draft"
        }
      };
    },
    async countActiveForWorkspace() {
      return 0;
    }
  };
}

test("projects command actions publish realtime events across api/assistant_tool/internal contexts", async () => {
  const publishCalls = [];
  const contributor = createProjectsActionContributor({
    projectsService: createProjectsServiceDouble(),
    realtimeEventsService: {
      publishProjectEvent(payload) {
        publishCalls.push(payload);
        return payload;
      }
    }
  });

  const createAction = getAction(contributor, ACTION_IDS.PROJECTS_CREATE);
  const updateAction = getAction(contributor, ACTION_IDS.PROJECTS_UPDATE);

  await createAction.execute(
    {
      name: "API project"
    },
    {
      channel: "api",
      actor: {
        id: 7
      },
      workspace: {
        id: 11,
        slug: "acme"
      },
      requestMeta: {
        commandId: "cmd_api_1",
        request: {
          headers: {
            "x-command-id": "cmd_api_1",
            "x-client-id": "cli_api_1"
          },
          user: {
            id: 7
          },
          workspace: {
            id: 11,
            slug: "acme"
          }
        }
      }
    }
  );

  await createAction.execute(
    {
      name: "Assistant project",
      sourceClientId: "cli_assist_1"
    },
    {
      channel: "assistant_tool",
      actor: {
        id: 8
      },
      workspace: {
        id: 11,
        slug: "acme"
      },
      requestMeta: {
        commandId: "cmd_assist_1"
      }
    }
  );

  await updateAction.execute(
    {
      projectId: 303,
      name: "Internal patch"
    },
    {
      channel: "internal",
      actor: {
        id: 9
      },
      workspace: {
        id: 11,
        slug: "acme"
      },
      requestMeta: {
        commandId: "cmd_internal_1",
        request: {
          headers: {
            "x-client-id": "cli_internal_1"
          }
        }
      }
    }
  );

  assert.equal(publishCalls.length, 3);

  assert.equal(publishCalls[0].operation, "created");
  assert.equal(publishCalls[0].commandId, "cmd_api_1");
  assert.equal(publishCalls[0].sourceClientId, "cli_api_1");
  assert.equal(publishCalls[0].actorUserId, 7);
  assert.equal(Number(publishCalls[0].workspace?.id), 11);

  assert.equal(publishCalls[1].operation, "created");
  assert.equal(publishCalls[1].commandId, "cmd_assist_1");
  assert.equal(publishCalls[1].sourceClientId, "cli_assist_1");
  assert.equal(publishCalls[1].actorUserId, 8);
  assert.equal(Number(publishCalls[1].workspace?.id), 11);

  assert.equal(publishCalls[2].operation, "updated");
  assert.equal(publishCalls[2].commandId, "cmd_internal_1");
  assert.equal(publishCalls[2].sourceClientId, "cli_internal_1");
  assert.equal(publishCalls[2].actorUserId, 9);
  assert.equal(Number(publishCalls[2].project?.id), 303);
});

