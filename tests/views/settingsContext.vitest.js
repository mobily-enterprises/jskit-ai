import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { describe, expect, it } from "vitest";

import { provideSettingsContext, useSettingsContext } from "../../src/views/settings/lib/useSettingsContext.js";

describe("useSettingsContext", () => {
  it("throws when settings context is missing", () => {
    const Harness = defineComponent({
      name: "SettingsContextMissingHarness",
      setup() {
        return useSettingsContext();
      },
      template: "<div />"
    });

    expect(() => mount(Harness)).toThrow("Settings context is unavailable.");
  });

  it("returns provided settings context", () => {
    const provided = {
      sections: {
        profile: {
          id: "profile"
        }
      }
    };

    const Child = defineComponent({
      name: "SettingsContextChild",
      setup() {
        return {
          context: useSettingsContext()
        };
      },
      template: "<div />"
    });

    const Parent = defineComponent({
      name: "SettingsContextParent",
      components: {
        Child
      },
      setup() {
        provideSettingsContext(provided);
      },
      template: "<Child ref='child' />"
    });

    const wrapper = mount(Parent);
    expect(wrapper.vm.$refs.child.context).toBe(provided);
  });
});
