import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  history: {
    pageSizeOptions: [10, 25, 50],
    error: "",
    loading: false,
    entries: [],
    page: 1,
    totalPages: 1,
    total: 0,
    pageSize: 10,
    load: vi.fn(),
    goPrevious: vi.fn(),
    goNext: vi.fn(),
    onPageSizeChange: vi.fn(),
    onCalculationCreated: vi.fn()
  }
}));

vi.mock("../../src/composables/useAnnuityHistory.js", () => ({
  useAnnuityHistory: () => mocks.history
}));

import CalculatorView from "../../src/views/CalculatorView.vue";

const CalculatorPanelStub = defineComponent({
  name: "AnnuityCalculatorForm",
  emits: ["calculated"],
  template: "<div data-test='calculator-panel' />"
});

const HistoryPanelStub = defineComponent({
  name: "AnnuityHistoryPanel",
  props: {
    pageSizeOptions: { type: Array, required: true },
    error: { type: String, required: true },
    loading: { type: Boolean, required: true },
    entries: { type: Array, required: true },
    page: { type: Number, required: true },
    totalPages: { type: Number, required: true },
    total: { type: Number, required: true },
    pageSize: { type: Number, required: true },
    formatDate: { type: Function, required: true },
    typeLabel: { type: Function, required: true },
    inputSummary: { type: Function, required: true },
    formatCurrency: { type: Function, required: true }
  },
  emits: ["refresh", "previous-page", "next-page", "page-size-change"],
  template: "<div data-test='history-panel' />"
});

function mountView() {
  return mount(CalculatorView, {
    global: {
      stubs: {
        AnnuityCalculatorForm: CalculatorPanelStub,
        AnnuityHistoryPanel: HistoryPanelStub
      }
    }
  });
}

describe("CalculatorView", () => {
  beforeEach(() => {
    mocks.history.load.mockReset();
    mocks.history.goPrevious.mockReset();
    mocks.history.goNext.mockReset();
    mocks.history.onPageSizeChange.mockReset();
    mocks.history.onCalculationCreated.mockReset();
    mocks.history.error = "";
    mocks.history.loading = false;
    mocks.history.entries = [];
    mocks.history.page = 1;
    mocks.history.totalPages = 1;
    mocks.history.total = 0;
    mocks.history.pageSize = 10;
  });

  it("forwards history props into history panel", () => {
    mocks.history.error = "History unavailable.";
    mocks.history.loading = true;
    mocks.history.entries = [{ id: "entry-1" }];
    mocks.history.page = 2;
    mocks.history.totalPages = 3;
    mocks.history.total = 11;
    mocks.history.pageSize = 25;

    const wrapper = mountView();
    const panel = wrapper.findComponent(HistoryPanelStub);

    expect(panel.props("pageSizeOptions")).toEqual([10, 25, 50]);
    expect(panel.props("error")).toBe("History unavailable.");
    expect(panel.props("loading")).toBe(true);
    expect(panel.props("entries")).toEqual([{ id: "entry-1" }]);
    expect(panel.props("page")).toBe(2);
    expect(panel.props("totalPages")).toBe(3);
    expect(panel.props("total")).toBe(11);
    expect(panel.props("pageSize")).toBe(25);
    expect(typeof panel.props("formatDate")).toBe("function");
    expect(typeof panel.props("typeLabel")).toBe("function");
    expect(typeof panel.props("inputSummary")).toBe("function");
    expect(typeof panel.props("formatCurrency")).toBe("function");
  });

  it("forwards history panel events to history handlers", async () => {
    const wrapper = mountView();
    const panel = wrapper.findComponent(HistoryPanelStub);

    await panel.vm.$emit("refresh");
    await panel.vm.$emit("previous-page");
    await panel.vm.$emit("next-page");
    await panel.vm.$emit("page-size-change", 50);

    expect(mocks.history.load).toHaveBeenCalledTimes(1);
    expect(mocks.history.goPrevious).toHaveBeenCalledTimes(1);
    expect(mocks.history.goNext).toHaveBeenCalledTimes(1);
    expect(mocks.history.onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("connects calculator calculated event to history refresh hook", async () => {
    const wrapper = mountView();
    const calculatorPanel = wrapper.findComponent(CalculatorPanelStub);

    await calculatorPanel.vm.$emit("calculated", { historyId: "h1" });

    expect(mocks.history.onCalculationCreated).toHaveBeenCalledWith({ historyId: "h1" });
  });
});
