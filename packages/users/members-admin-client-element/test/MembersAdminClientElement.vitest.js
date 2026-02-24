import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MembersAdminClientElement from "../src/MembersAdminClientElement.vue";

const componentSourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/MembersAdminClientElement.vue");

function readSource() {
  return readFileSync(componentSourcePath, "utf8");
}

function mountElement(options) {
  return mount(MembersAdminClientElement, {
    global: {
      config: {
        warnHandler: () => {}
      }
    },
    ...options
  });
}

function createBaseProps(overrides = {}) {
  return {
    mode: "workspace",
    forms: {
      invite: {
        email: "",
        roleId: "member"
      },
      workspace: {
        invitesAvailable: true,
        invitesEnabled: true
      }
    },
    options: {
      inviteRoles: [{ title: "member", value: "member" }],
      memberRoles: [{ title: "member", value: "member" }],
      formatDateTime: () => "Feb 24, 2026"
    },
    collections: {
      list: [{ userId: 1, displayName: "Alex", email: "alex@example.com", roleId: "member", isOwner: false }],
      invites: [{ id: 1, email: "new@example.com", roleId: "member", expiresAt: "2026-02-24T00:00:00.000Z" }]
    },
    permissions: {
      canViewMembers: true,
      canInviteMembers: true,
      canManageMembers: true,
      canRevokeInvites: true
    },
    feedback: {
      inviteMessage: "",
      inviteMessageType: "success",
      teamMessage: "",
      teamMessageType: "success",
      revokeInviteId: 0
    },
    status: {
      isCreatingInvite: false,
      isRevokingInvite: false
    },
    actions: {
      submitInvite: async () => {},
      submitRevokeInvite: async () => {},
      submitMemberRoleUpdate: async () => {}
    },
    ...overrides
  };
}

describe("MembersAdminClientElement", () => {
  it("declares mode-aware contract, emits, and slots", () => {
    const source = readSource();

    expect(source.includes("mode")).toBe(true);
    expect(source.includes('"invite:submit"')).toBe(true);
    expect(source.includes('"invite:revoke"')).toBe(true);
    expect(source.includes('"member:role-update"')).toBe(true);
    expect(source.includes('slot name="invite-form-extra"')).toBe(true);
    expect(source.includes('slot name="members-list-extra"')).toBe(true);
    expect(source.includes('slot name="invites-list-extra"')).toBe(true);
  });

  it("applies variant classes", () => {
    const wrapper = mountElement({
      props: createBaseProps({
        variant: {
          layout: "compact",
          surface: "plain",
          density: "compact",
          tone: "emphasized"
        }
      })
    });

    expect(wrapper.classes()).toContain("members-admin-client-element--layout-compact");
    expect(wrapper.classes()).toContain("members-admin-client-element--surface-plain");
  });

  it("supports extension slots", () => {
    const wrapper = mountElement({
      props: createBaseProps(),
      slots: {
        "members-list-extra": "<div data-testid='members-extra-slot'>Extra</div>"
      }
    });

    expect(wrapper.get('[data-testid="members-extra-slot"]').exists()).toBe(true);
  });
});
