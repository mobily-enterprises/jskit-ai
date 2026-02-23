import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceRenameTool } from "../server/modules/ai/tools/workspaceRename.tool.js";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../shared/realtime/eventTypes.js";

test("workspace rename tool updates workspace settings and publishes workspace events", async () => {
  const calls = {
    update: [],
    events: []
  };

  const tool = createWorkspaceRenameTool({
    workspaceAdminService: {
      async updateWorkspaceSettings(workspace, payload) {
        calls.update.push({ workspace, payload });
        return {
          workspace: {
            id: workspace.id,
            slug: workspace.slug,
            name: payload.name
          }
        };
      }
    },
    realtimeEventsService: {
      publishWorkspaceEvent(payload) {
        calls.events.push(payload);
      }
    }
  });

  const context = {
    workspace: {
      id: 12,
      slug: "acme"
    },
    request: {
      headers: {
        "x-command-id": "cmd_1",
        "x-client-id": "client_1"
      },
      user: {
        id: 33
      }
    }
  };

  const result = await tool.execute({
    args: {
      name: "Renamed Workspace"
    },
    context
  });

  assert.deepEqual(calls.update, [
    {
      workspace: context.workspace,
      payload: {
        name: "Renamed Workspace"
      }
    }
  ]);

  assert.equal(calls.events.length, 2);
  assert.equal(calls.events[0].topic, REALTIME_TOPICS.WORKSPACE_SETTINGS);
  assert.equal(calls.events[0].eventType, REALTIME_EVENT_TYPES.WORKSPACE_SETTINGS_UPDATED);
  assert.equal(calls.events[1].topic, REALTIME_TOPICS.WORKSPACE_META);
  assert.equal(calls.events[1].eventType, REALTIME_EVENT_TYPES.WORKSPACE_META_UPDATED);

  for (const event of calls.events) {
    assert.equal(event.commandId, "cmd_1");
    assert.equal(event.sourceClientId, "client_1");
    assert.equal(event.actorUserId, 33);
    assert.equal(event.payload.workspaceId, 12);
    assert.equal(event.payload.workspaceSlug, "acme");
  }

  assert.deepEqual(result, {
    workspaceId: 12,
    workspaceSlug: "acme",
    name: "Renamed Workspace"
  });
});
