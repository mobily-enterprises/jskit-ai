import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { describe, expect, it } from "vitest";
import ChoiceTwoView from "../../src/views/ChoiceTwoView.vue";

const passthroughStub = defineComponent({
  template: "<div><slot /></div>"
});

describe("ChoiceTwoView", () => {
  it("renders placeholder module content", () => {
    const wrapper = mount(ChoiceTwoView, {
      global: {
        stubs: {
          "v-row": passthroughStub,
          "v-col": passthroughStub,
          "v-card": passthroughStub,
          "v-card-item": passthroughStub,
          "v-card-title": passthroughStub,
          "v-card-subtitle": passthroughStub,
          "v-divider": passthroughStub,
          "v-card-text": passthroughStub
        }
      }
    });

    expect(wrapper.text()).toContain("Choice 2");
    expect(wrapper.text()).toContain("future feature module");
  });
});
