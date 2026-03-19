import assert from "node:assert/strict";
import test from "node:test";
import {
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACE,
  WORKSPACE_SLUG_POLICY_NONE,
  WORKSPACE_SLUG_POLICY_IMMUTABLE_USERNAME,
  WORKSPACE_SLUG_POLICY_USER_SELECTED,
  resolveTenancyProfile,
  isWorkspaceTenancyMode
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

  const workspaceProfile = resolveTenancyProfile({ tenancyMode: TENANCY_MODE_WORKSPACE });
  assert.deepEqual(workspaceProfile, {
    mode: TENANCY_MODE_WORKSPACE,
    workspace: {
      enabled: true,
      autoProvision: false,
      allowSelfCreate: false,
      slugPolicy: WORKSPACE_SLUG_POLICY_USER_SELECTED
    }
  });
});

test("isWorkspaceTenancyMode is true only for workspace mode", () => {
  assert.equal(isWorkspaceTenancyMode(TENANCY_MODE_WORKSPACE), true);
  assert.equal(isWorkspaceTenancyMode(TENANCY_MODE_PERSONAL), false);
  assert.equal(isWorkspaceTenancyMode(TENANCY_MODE_NONE), false);
});

test("resolveTenancyProfile allows explicit workspace self-create policy override", () => {
  const workspaceProfile = resolveTenancyProfile({
    tenancyMode: TENANCY_MODE_WORKSPACE,
    tenancyPolicy: {
      workspace: {
        allowSelfCreate: true
      }
    }
  });

  assert.equal(workspaceProfile.mode, TENANCY_MODE_WORKSPACE);
  assert.equal(workspaceProfile.workspace.allowSelfCreate, true);
});
