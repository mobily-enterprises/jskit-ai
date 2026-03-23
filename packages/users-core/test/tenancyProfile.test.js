import assert from "node:assert/strict";
import test from "node:test";
import {
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACES,
  WORKSPACE_SLUG_POLICY_NONE,
  WORKSPACE_SLUG_POLICY_IMMUTABLE_USERNAME,
  WORKSPACE_SLUG_POLICY_USER_SELECTED,
  resolveTenancyProfile,
  isWorkspacesTenancyMode
} from "../src/shared/tenancyProfile.js";

test("resolveTenancyProfile returns mode-specific workspace policy matrix", () => {
  const noneProfile = resolveTenancyProfile({ tenancyMode: TENANCY_MODE_NONE });
  assert.deepEqual(noneProfile, {
    mode: TENANCY_MODE_NONE,
    workspace: {
      enabled: false,
      autoProvision: false,
      allowSelfCreate: false,
      slugPolicy: WORKSPACE_SLUG_POLICY_NONE
    }
  });

  const personalProfile = resolveTenancyProfile({ tenancyMode: TENANCY_MODE_PERSONAL });
  assert.deepEqual(personalProfile, {
    mode: TENANCY_MODE_PERSONAL,
    workspace: {
      enabled: true,
      autoProvision: true,
      allowSelfCreate: false,
      slugPolicy: WORKSPACE_SLUG_POLICY_IMMUTABLE_USERNAME
    }
  });

  const workspaceProfile = resolveTenancyProfile({ tenancyMode: TENANCY_MODE_WORKSPACES });
  assert.deepEqual(workspaceProfile, {
    mode: TENANCY_MODE_WORKSPACES,
    workspace: {
      enabled: true,
      autoProvision: false,
      allowSelfCreate: false,
      slugPolicy: WORKSPACE_SLUG_POLICY_USER_SELECTED
    }
  });
});

test("isWorkspacesTenancyMode is true only for workspace mode", () => {
  assert.equal(isWorkspacesTenancyMode(TENANCY_MODE_WORKSPACES), true);
  assert.equal(isWorkspacesTenancyMode(TENANCY_MODE_PERSONAL), false);
  assert.equal(isWorkspacesTenancyMode(TENANCY_MODE_NONE), false);
});

test("resolveTenancyProfile allows explicit workspace self-create policy override", () => {
  const workspaceProfile = resolveTenancyProfile({
    tenancyMode: TENANCY_MODE_WORKSPACES,
    tenancyPolicy: {
      workspace: {
        allowSelfCreate: true
      }
    }
  });

  assert.equal(workspaceProfile.mode, TENANCY_MODE_WORKSPACES);
  assert.equal(workspaceProfile.workspace.allowSelfCreate, true);
});
