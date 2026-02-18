import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined),
  routerPathname: "/w/acme",
  routerSearch: {},
  api: {
    history: vi.fn()
  },
  workspaceStore: {
    initialized: true,
    activeWorkspaceSlug: ""
  },
  handleUnauthorizedError: vi.fn(async () => false),
  queryData: null,
  queryError: null,
  queryPending: null,
  queryFetching: null,
  queryRefetch: vi.fn(async () => undefined),
  invalidateQueries: vi.fn(async () => undefined)
}));

vi.mock("@tanstack/vue-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: (options) => {
    const state = {
      location: {
        pathname: mocks.routerPathname,
        search: mocks.routerSearch
      }
    };

    return {
      value: options?.select ? options.select(state) : state
    };
  }
}));

vi.mock("@tanstack/vue-query", () => ({
  useQuery: (options = {}) => {
    if (options.queryKey && typeof options.queryKey === "object" && "value" in options.queryKey) {
      void options.queryKey.value;
    }

    if (typeof options.queryFn === "function") {
      void options.queryFn();
    }

    if (options.enabled && typeof options.enabled === "object" && "value" in options.enabled) {
      void options.enabled.value;
    }

    if (typeof options.placeholderData === "function") {
      options.placeholderData(undefined);
    }

    return {
      data: mocks.queryData,
      error: mocks.queryError,
      isPending: mocks.queryPending,
      isFetching: mocks.queryFetching,
      refetch: mocks.queryRefetch
    };
  },
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries
  })
}));

vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
}));

vi.mock("../../src/composables/useAuthGuard.js", () => ({
  useAuthGuard: () => ({
    handleUnauthorizedError: mocks.handleUnauthorizedError
  })
}));

vi.mock("../../src/stores/workspaceStore.js", () => ({
  useWorkspaceStore: () => mocks.workspaceStore
}));

import {
  HISTORY_QUERY_KEY_PREFIX,
  useAnnuityHistoryList
} from "../../src/components/annuity-history-list/useAnnuityHistoryList.js";

function mountHarness(options) {
  const Harness = defineComponent({
    name: "UseAnnuityHistoryListHarness",
    setup() {
      return {
        history: useAnnuityHistoryList(options)
      };
    },
    template: "<div />"
  });

  return mount(Harness);
}

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("useAnnuityHistoryList", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.routerPathname = "/w/acme";
    mocks.routerSearch = {};
    mocks.api.history.mockReset();
    mocks.api.history.mockResolvedValue({
      entries: [],
      total: 0,
      totalPages: 1
    });
    mocks.handleUnauthorizedError.mockReset();
    mocks.handleUnauthorizedError.mockResolvedValue(false);
    mocks.queryData = ref({
      entries: [],
      total: 0,
      totalPages: 1
    });
    mocks.queryError = ref(null);
    mocks.queryPending = ref(false);
    mocks.queryFetching = ref(false);
    mocks.queryRefetch.mockReset();
    mocks.queryRefetch.mockResolvedValue(undefined);
    mocks.invalidateQueries.mockReset();
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.workspaceStore.initialized = true;
    mocks.workspaceStore.activeWorkspaceSlug = "acme";
  });

  it("initializes state, normalizes inputs, and exposes reactive data", async () => {
    const wrapper = mountHarness({ initialPageSize: 0 });
    await flush();

    expect(wrapper.vm.history.meta.pageSizeOptions).toEqual([10, 25, 50]);
    expect(wrapper.vm.history.state.enabled).toBe(true);
    expect(wrapper.vm.history.state.page).toBe(1);
    expect(wrapper.vm.history.state.pageSize).toBe(10);
    expect(mocks.api.history).toHaveBeenCalledWith(1, 10);

    mocks.queryData.value = {
      entries: [{ id: "e1" }],
      total: "11",
      totalPages: 3
    };
    await flush();
    expect(wrapper.vm.history.state.entries).toEqual([{ id: "e1" }]);
    expect(wrapper.vm.history.state.total).toBe(11);
    expect(wrapper.vm.history.state.totalPages).toBe(3);

    mocks.queryData.value = {
      entries: null,
      total: "9",
      totalPages: 0
    };
    await flush();
    expect(wrapper.vm.history.state.entries).toEqual([]);
    expect(wrapper.vm.history.state.total).toBe(9);
    expect(wrapper.vm.history.state.totalPages).toBe(1);

    mocks.queryData.value = null;
    await flush();
    expect(wrapper.vm.history.state.entries).toEqual([]);
    expect(wrapper.vm.history.state.total).toBe(0);
    expect(wrapper.vm.history.state.totalPages).toBe(1);
  });

  it("handles history errors for unauthorized and non-unauthorized branches", async () => {
    const wrapper = mountHarness();
    await flush();

    mocks.queryError.value = {
      status: 500,
      message: "History unavailable."
    };
    await flush();
    expect(mocks.handleUnauthorizedError).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.history.state.error).toBe("History unavailable.");

    mocks.queryError.value = null;
    await flush();
    expect(wrapper.vm.history.state.error).toBe("");

    mocks.handleUnauthorizedError.mockResolvedValueOnce(true);
    mocks.queryError.value = {
      status: 401,
      message: "Authentication required."
    };
    await flush();
    expect(mocks.handleUnauthorizedError).toHaveBeenCalledTimes(2);
    expect(wrapper.vm.history.state.error).toBe("");
  });

  it("supports paging actions and page size changes", async () => {
    const wrapper = mountHarness();
    await flush();

    mocks.queryData.value = {
      entries: [],
      total: 0,
      totalPages: 3
    };
    await flush();

    wrapper.vm.history.actions.goPrevious();
    expect(wrapper.vm.history.state.page).toBe(1);

    wrapper.vm.history.actions.goNext();
    expect(wrapper.vm.history.state.page).toBe(2);

    mocks.queryPending.value = true;
    wrapper.vm.history.actions.goNext();
    expect(wrapper.vm.history.state.page).toBe(2);

    mocks.queryPending.value = false;
    wrapper.vm.history.state.page = 3;
    wrapper.vm.history.actions.goNext();
    expect(wrapper.vm.history.state.page).toBe(3);

    wrapper.vm.history.state.page = 2;
    wrapper.vm.history.actions.onPageSizeChange(undefined);
    expect(wrapper.vm.history.state.page).toBe(1);
    expect(wrapper.vm.history.state.pageSize).toBe(10);

    wrapper.vm.history.state.page = 2;
    wrapper.vm.history.actions.onPageSizeChange(25);
    expect(wrapper.vm.history.state.page).toBe(1);
    expect(wrapper.vm.history.state.pageSize).toBe(25);
  });

  it("refreshes data and invalidates history after calculation", async () => {
    const wrapper = mountHarness();
    await flush();

    await wrapper.vm.history.actions.load();
    expect(mocks.queryRefetch).toHaveBeenCalledTimes(1);

    wrapper.vm.history.state.page = 2;
    await wrapper.vm.history.actions.onCalculationCreated();
    expect(wrapper.vm.history.state.page).toBe(1);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: [...HISTORY_QUERY_KEY_PREFIX, "acme"]
    });
  });

  it("exposes disabled state when workspace context is not ready", async () => {
    mocks.workspaceStore.initialized = false;
    mocks.workspaceStore.activeWorkspaceSlug = "";

    const wrapper = mountHarness();
    await flush();

    expect(wrapper.vm.history.state.enabled).toBe(false);
  });
});
