import { defineFeature } from "@jskit-ai/kernel/server/features";
import { WORKSPACES_TABLES, createWorkspaceRecords } from "../server/workspacesRuntime.js";

// For an application's tests: the workspaces tables' owner with only its records, the `workspaces` and
// `workspaces.memberships` capabilities workspaces.core provides, without its routes, settings or invitations. A test
// that starts its features with @jskit-ai/resource-runtime/test's startTestFeatures adds it beside them.
const WorkspaceRecordsFeature = defineFeature({
  id: "workspaces.core",
  owns: WORKSPACES_TABLES,
  provides: {
    workspaceRecords: "workspaces",
    workspaceMemberships: "workspaces.memberships"
  },
  /**
   * @param {object} capabilities
   * @param {import("../server/types.js").WorkspacesResources} capabilities.resources
   */
  setup({ resources }) {
    const records = createWorkspaceRecords(resources);
    return {
      workspaceRecords: records.workspaces,
      workspaceMemberships: records.memberships
    };
  }
});

export { WorkspaceRecordsFeature };
