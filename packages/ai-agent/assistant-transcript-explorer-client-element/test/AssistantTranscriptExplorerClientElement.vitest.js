import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AssistantTranscriptExplorerClientElement from "../src/shared/AssistantTranscriptExplorerClientElement.vue";

const componentSourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/shared/AssistantTranscriptExplorerClientElement.vue"
);

function readSource() {
  return readFileSync(componentSourcePath, "utf8");
}

function mountElement(options) {
  return mount(AssistantTranscriptExplorerClientElement, {
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
    meta: {
      statusOptions: [{ title: "All", value: "" }],
      pageSizeOptions: [20, 50],
      formatDateTime: () => "Feb 24, 2026",
      formatTranscriptMode: () => "Standard",
      summarizeContent: () => "summary",
      formatConversationActor: () => "Actor"
    },
    state: {
      error: "",
      statusFilter: "",
      pageSize: 20,
      memberUserFilter: "",
      memberFilterOptions: [{ title: "All users", value: "" }],
      loading: false,
      entries: [],
      selectedConversation: null,
      page: 1,
      totalPages: 1,
      messagesError: "",
      messagesLoading: false,
      messages: [],
      exportBusy: false,
      workspaceIdFilter: ""
    },
    actions: {
      loadConversations: async () => {},
      applyFilters: async () => {},
      selectConversation: async () => {},
      exportConversation: async () => {},
      exportSelection: async () => {},
      goPreviousPage: async () => {},
      goNextPage: async () => {},
      setPageSize: async () => {},
      setStatusFilter: async () => {},
      setMemberFilter: async () => {}
    },
    ...overrides
  };
}

describe("AssistantTranscriptExplorerClientElement", () => {
  it("declares mode-specific filter contract in source", () => {
    const source = readSource();

    expect(source.includes("mode")).toBe(true);
    expect(source.includes("state.workspaceIdFilter")).toBe(true);
    expect(source.includes("state.memberFilterOptions")).toBe(true);
    expect(source.includes("actions.setMemberFilter")).toBe(true);
    expect(source.includes("actions.applyFilters")).toBe(true);
  });

  it("declares emits and slots contract", () => {
    const source = readSource();

    expect(source.includes('"filters:apply"')).toBe(true);
    expect(source.includes('"transcript:select"')).toBe(true);
    expect(source.includes('"transcript:export"')).toBe(true);
    expect(source.includes('slot name="filters-extra"')).toBe(true);
    expect(source.includes('slot name="detail-extra"')).toBe(true);
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

    expect(wrapper.classes()).toContain("assistant-transcript-explorer-client-element--layout-compact");
    expect(wrapper.classes()).toContain("assistant-transcript-explorer-client-element--surface-plain");
  });
});
