import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import { describe, expect, it, vi } from "vitest";
import MembersAdminClientElement from "../src/shared/MembersAdminClientElement.vue";

const componentSourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/shared/MembersAdminClientElement.vue");

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
    expect(source.includes('name="invite-form-extra"')).toBe(true);
    expect(source.includes('name="members-list-extra"')).toBe(true);
    expect(source.includes('name="invites-list-extra"')).toBe(true);
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

  it("does not show workspace invite policy warning while settings are loading", () => {
    const wrapper = mountElement({
      props: createBaseProps({
        forms: {
          invite: {
            email: "",
            roleId: "member"
          },
          workspace: {
            invitesAvailable: false,
            invitesEnabled: true
          }
        },
        status: {
          isCreatingInvite: false,
          isRevokingInvite: false,
          hasLoadedWorkspaceSettings: false
        }
      })
    });

    expect(wrapper.html().includes("v-skeleton-loader")).toBe(true);
    expect(wrapper.text()).not.toContain("Invites are disabled by app policy or role manifest.");
  });

  it("shows workspace invite policy warning once settings are loaded", () => {
    const wrapper = mountElement({
      props: createBaseProps({
        forms: {
          invite: {
            email: "",
            roleId: "member"
          },
          workspace: {
            invitesAvailable: false,
            invitesEnabled: true
          }
        },
        status: {
          isCreatingInvite: false,
          isRevokingInvite: false,
          hasLoadedWorkspaceSettings: true
        }
      })
    });

    expect(wrapper.text()).toContain("Invites are disabled by app policy or role manifest.");
  });

  it("shows members skeleton while members data is loading", () => {
    const wrapper = mountElement({
      props: createBaseProps({
        status: {
          isCreatingInvite: false,
          isRevokingInvite: false,
          hasLoadedMembersList: false,
          hasLoadedInviteList: false
        }
      })
    });

    expect(wrapper.html().includes("v-skeleton-loader")).toBe(true);
    expect(wrapper.text()).not.toContain("No pending invites.");
  });

  it("hides members skeleton once members data is loaded", () => {
    const wrapper = mountElement({
      props: createBaseProps({
        status: {
          isCreatingInvite: false,
          isRevokingInvite: false,
          hasLoadedMembersList: true,
          hasLoadedInviteList: true
        }
      })
    });

    expect(wrapper.text()).toContain("Pending invites");
  });

  it("blocks slot-invoked invite and revoke actions when permissions are missing", async () => {
    const submitInvite = vi.fn(async () => {});
    const submitRevokeInvite = vi.fn(async () => {});
    const wrapper = mountElement({
      props: createBaseProps({
        permissions: {
          canViewMembers: true,
          canInviteMembers: false,
          canManageMembers: true,
          canRevokeInvites: false
        },
        actions: {
          submitInvite,
          submitRevokeInvite,
          submitMemberRoleUpdate: vi.fn(async () => {})
        }
      }),
      slots: {
        "members-list-extra": ({ actions }) =>
          h(
            "button",
            {
              "data-testid": "slot-submit-invite",
              onClick: () => actions.submitInvite()
            },
            "Submit invite from slot"
          ),
        "invites-list-extra": ({ actions }) =>
          h(
            "button",
            {
              "data-testid": "slot-submit-revoke",
              onClick: () => actions.submitRevokeInvite(1)
            },
            "Submit revoke from slot"
          )
      }
    });

    await wrapper.get('[data-testid="slot-submit-invite"]').trigger("click");
    await wrapper.get('[data-testid="slot-submit-revoke"]').trigger("click");

    expect(submitInvite).not.toHaveBeenCalled();
    expect(submitRevokeInvite).not.toHaveBeenCalled();
  });

  it("allows slot-invoked invite and revoke actions when permissions are granted", async () => {
    const submitInvite = vi.fn(async () => {});
    const submitRevokeInvite = vi.fn(async () => {});
    const wrapper = mountElement({
      props: createBaseProps({
        actions: {
          submitInvite,
          submitRevokeInvite,
          submitMemberRoleUpdate: vi.fn(async () => {})
        }
      }),
      slots: {
        "members-list-extra": ({ actions }) =>
          h(
            "button",
            {
              "data-testid": "slot-submit-invite",
              onClick: () => actions.submitInvite()
            },
            "Submit invite from slot"
          ),
        "invites-list-extra": ({ actions }) =>
          h(
            "button",
            {
              "data-testid": "slot-submit-revoke",
              onClick: () => actions.submitRevokeInvite(7)
            },
            "Submit revoke from slot"
          )
      }
    });

    await wrapper.get('[data-testid="slot-submit-invite"]').trigger("click");
    await wrapper.get('[data-testid="slot-submit-revoke"]').trigger("click");

    expect(submitInvite).toHaveBeenCalledTimes(1);
    expect(submitRevokeInvite).toHaveBeenCalledTimes(1);
    expect(submitRevokeInvite).toHaveBeenCalledWith(7);
  });

  it("blocks locked member role updates even when invoked from slot actions", async () => {
    const submitMemberRoleUpdate = vi.fn(async () => {});
    const wrapper = mountElement({
      props: createBaseProps({
        actions: {
          submitInvite: vi.fn(async () => {}),
          submitRevokeInvite: vi.fn(async () => {}),
          submitMemberRoleUpdate
        }
      }),
      slots: {
        "members-list-extra": ({ actions }) =>
          h("div", [
            h(
              "button",
              {
                "data-testid": "slot-submit-locked-role",
                onClick: () => actions.submitMemberRoleUpdate({ userId: 3, isOwner: true }, "admin")
              },
              "Submit locked role update"
            ),
            h(
              "button",
              {
                "data-testid": "slot-submit-open-role",
                onClick: () => actions.submitMemberRoleUpdate({ userId: 4, isOwner: false }, "admin")
              },
              "Submit open role update"
            )
          ])
      }
    });

    await wrapper.get('[data-testid="slot-submit-locked-role"]').trigger("click");
    await wrapper.get('[data-testid="slot-submit-open-role"]').trigger("click");

    expect(submitMemberRoleUpdate).toHaveBeenCalledTimes(1);
    expect(submitMemberRoleUpdate).toHaveBeenCalledWith({ userId: 4, isOwner: false }, "admin");
  });
});
