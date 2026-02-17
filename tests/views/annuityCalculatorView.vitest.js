import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AnnuityCalculatorView from "../../src/views/annuity-calculator/AnnuityCalculatorView.vue";

const CalculatorPanelStub = defineComponent({
  name: "AnnuityCalculatorForm",
  emits: ["calculated"],
  template: "<div data-test='calculator-panel' />"
});

const HistoryListStub = defineComponent({
  name: "AnnuityHistoryList",
  props: {
    refreshToken: {
      type: Number,
      default: 0
    }
  },
  template: "<div data-test='history-panel' />"
});

function mountView() {
  return mount(AnnuityCalculatorView, {
    global: {
      stubs: {
        AnnuityCalculatorForm: CalculatorPanelStub,
        AnnuityHistoryList: HistoryListStub
      }
    }
  });
}

describe("AnnuityCalculatorView", () => {
  it("renders calculator and history panels with initial refresh token", () => {
    const wrapper = mountView();
    const calculatorPanel = wrapper.findComponent(CalculatorPanelStub);
    const historyPanel = wrapper.findComponent(HistoryListStub);

    expect(calculatorPanel.exists()).toBe(true);
    expect(historyPanel.exists()).toBe(true);
    expect(historyPanel.props("refreshToken")).toBe(0);
  });

  it("increments history refresh token after each calculated event", async () => {
    const wrapper = mountView();
    const calculatorPanel = wrapper.findComponent(CalculatorPanelStub);
    const historyPanel = () => wrapper.findComponent(HistoryListStub);

    await calculatorPanel.vm.$emit("calculated", { historyId: "h1" });
    await nextTick();
    expect(historyPanel().props("refreshToken")).toBe(1);

    await calculatorPanel.vm.$emit("calculated", { historyId: "h2" });
    await nextTick();
    expect(historyPanel().props("refreshToken")).toBe(2);
  });
});
