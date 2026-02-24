import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ConsoleErrorListClientElement from "../src/ConsoleErrorListClientElement.vue";
import ConsoleErrorDetailClientElement from "../src/ConsoleErrorDetailClientElement.vue";

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const listSourcePath = path.resolve(baseDir, "../src/ConsoleErrorListClientElement.vue");
const detailSourcePath = path.resolve(baseDir, "../src/ConsoleErrorDetailClientElement.vue");

function readSource(filePath) {
  return readFileSync(filePath, "utf8");
}

function mountWithWarningsSuppressed(component, options) {
  return mount(component, {
    global: {
      config: {
        warnHandler: () => {}
      }
    },
    ...options
  });
}

describe("Console errors client elements", () => {
  it("declares mode and emits contracts in source", () => {
    const listSource = readSource(listSourcePath);
    const detailSource = readSource(detailSourcePath);

    expect(listSource.includes("mode")).toBe(true);
    expect(listSource.includes('"simulate:trigger"')).toBe(true);
    expect(listSource.includes('"error:view"')).toBe(true);
    expect(detailSource.includes("mode")).toBe(true);
    expect(detailSource.includes('"action:started"')).toBe(true);
  });

  it("applies variant classes for list element", () => {
    const wrapper = mountWithWarningsSuppressed(ConsoleErrorListClientElement, {
      props: {
        mode: "browser",
        meta: {
          pageSizeOptions: [20],
          nextSimulationLabel: "window.error",
          formatDateTime: () => "Feb 24, 2026",
          summarizeBrowserMessage: () => "message",
          formatLocation: () => "file.js:1"
        },
        state: {
          pageSize: 20,
          loading: false,
          simulationMessage: "",
          simulationMessageType: "success",
          error: "",
          entries: [],
          page: 1,
          totalPages: 1,
          total: 0
        },
        actions: {
          onPageSizeChange: async () => {},
          load: async () => {},
          simulateClientError: async () => {},
          viewEntry: async () => {},
          goPrevious: async () => {},
          goNext: async () => {}
        },
        variant: {
          layout: "compact",
          surface: "plain",
          density: "compact",
          tone: "emphasized"
        }
      }
    });

    expect(wrapper.classes()).toContain("console-error-list-client-element--layout-compact");
    expect(wrapper.classes()).toContain("console-error-list-client-element--surface-plain");
  });

  it("applies variant classes for detail element", () => {
    const wrapper = mountWithWarningsSuppressed(ConsoleErrorDetailClientElement, {
      props: {
        mode: "server",
        meta: {
          formatDateTime: () => "Feb 24, 2026",
          formatRequest: () => "GET /api/health",
          summarizeServerMessage: () => "message",
          formatJson: () => "{}"
        },
        state: {
          loading: false,
          hasValidErrorId: true,
          error: "",
          entry: {
            id: 1,
            createdAt: "2026-02-24T00:00:00.000Z",
            statusCode: 500,
            userId: 1,
            requestId: "req_1",
            metadata: {}
          }
        },
        actions: {
          refresh: async () => {},
          goBack: async () => {}
        },
        variant: {
          layout: "compact",
          surface: "plain",
          density: "compact",
          tone: "emphasized"
        }
      }
    });

    expect(wrapper.classes()).toContain("console-error-detail-client-element--layout-compact");
    expect(wrapper.classes()).toContain("console-error-detail-client-element--surface-plain");
  });
});
