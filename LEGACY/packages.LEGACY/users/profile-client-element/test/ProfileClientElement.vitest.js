import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ProfileClientElement from "../src/lib/ProfileClientElement.vue";

function mountElement(options) {
  return mount(ProfileClientElement, {
    global: {
      config: {
        warnHandler: () => {}
      }
    },
    ...options
  });
}

function createBaseProps(overrides = {}) {
  const state = {
    preferencesForm: {
      avatarSize: 96
    },
    profileAvatar: {
      effectiveUrl: "",
      hasUploadedAvatar: true
    },
    profileInitials: "JD",
    selectedAvatarFileName: "avatar.png",
    avatarMessage: "",
    avatarMessageType: "success",
    profileForm: {
      displayName: "Jordan Doe",
      email: "jordan@example.com"
    },
    profileFieldErrors: {
      displayName: ""
    },
    profileMessage: "",
    profileMessageType: "success",
    avatarDeleteMutation: {
      isPending: {
        value: false
      }
    },
    profileMutation: {
      isPending: {
        value: false
      }
    }
  };

  const actions = {
    submitProfile: vi.fn(async () => {}),
    openAvatarEditor: vi.fn(async () => {}),
    submitAvatarDelete: vi.fn(async () => {})
  };

  return {
    state,
    actions,
    ...overrides
  };
}

describe("ProfileClientElement", () => {
  it("renders profile form sections", () => {
    const wrapper = mountElement({ props: createBaseProps() });

    expect(wrapper.text()).toContain("Profile");
    expect(wrapper.text()).toContain("Replace avatar");
    expect(wrapper.text()).toContain("Save profile");
  });

  it("emits profile domain events and invokes actions", async () => {
    const props = createBaseProps();
    const wrapper = mountElement({ props });

    await wrapper.get('[data-testid="profile-avatar-replace-button"]').trigger("click");
    await wrapper.get('[data-testid="profile-avatar-remove-button"]').trigger("click");
    await wrapper.get("v-form").trigger("submit");

    expect(props.actions.openAvatarEditor).toHaveBeenCalledTimes(1);
    expect(props.actions.submitAvatarDelete).toHaveBeenCalledTimes(1);
    expect(props.actions.submitProfile).toHaveBeenCalledTimes(1);

    expect(wrapper.emitted("avatar:replace")?.length).toBe(1);
    expect(wrapper.emitted("avatar:remove")?.length).toBe(1);
    expect(wrapper.emitted("profile:submit")?.length).toBe(1);
    expect(wrapper.emitted("interaction")?.length).toBeGreaterThan(0);
  });

  it("supports slots and variant classes", () => {
    const wrapper = mountElement({
      props: createBaseProps({
        variant: {
          layout: "compact",
          surface: "plain",
          density: "compact",
          tone: "emphasized"
        }
      }),
      slots: {
        "avatar-actions-extra": "<div data-testid='avatar-actions-extra-slot'>Avatar extra</div>"
      }
    });

    expect(wrapper.get('[data-testid="avatar-actions-extra-slot"]').exists()).toBe(true);
    expect(wrapper.classes()).toContain("profile-client-element--layout-compact");
    expect(wrapper.classes()).toContain("profile-client-element--surface-plain");
  });
});
