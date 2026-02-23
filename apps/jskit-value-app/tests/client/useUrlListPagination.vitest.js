import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useUrlListPagination } from "../../src/composables/useUrlListPagination.js";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined)
}));

const routerPathname = ref("/w/acme");
const routerSearch = ref({});

vi.mock("@tanstack/vue-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: (options) => ({
    get value() {
      const state = {
        location: {
          pathname: routerPathname.value,
          search: routerSearch.value
        }
      };
      return options?.select ? options.select(state) : state;
    }
  })
}));

function mountHarness(options = {}) {
  const Harness = defineComponent({
    name: "UseUrlListPaginationHarness",
    setup() {
      return {
        pagination: useUrlListPagination(options)
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

describe("useUrlListPagination", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.navigate.mockResolvedValue(undefined);
    routerPathname.value = "/w/acme";
    routerSearch.value = {};
  });

  it("initializes from URL and normalizes invalid values", async () => {
    routerSearch.value = {
      historyPage: "3",
      historyPageSize: "999"
    };

    const wrapper = mountHarness({
      pageKey: "historyPage",
      pageSizeKey: "historyPageSize",
      defaultPageSize: 10,
      pageSizeOptions: [10, 25, 50]
    });
    await flush();

    expect(wrapper.vm.pagination.page.value).toBe(3);
    expect(wrapper.vm.pagination.pageSize.value).toBe(10);
  });

  it("uses initial page size when URL does not provide one", async () => {
    const wrapper = mountHarness({
      pageKey: "historyPage",
      pageSizeKey: "historyPageSize",
      initialPageSize: 25,
      defaultPageSize: 10,
      pageSizeOptions: [10, 25, 50]
    });
    await flush();

    expect(wrapper.vm.pagination.page.value).toBe(1);
    expect(wrapper.vm.pagination.pageSize.value).toBe(25);
  });

  it("writes pagination state back to URL search and omits defaults", async () => {
    const wrapper = mountHarness({
      pageKey: "historyPage",
      pageSizeKey: "historyPageSize",
      defaultPageSize: 10,
      pageSizeOptions: [10, 25, 50]
    });
    await flush();

    wrapper.vm.pagination.goNext({ totalPages: 3, isLoading: false });
    await flush();
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: "/w/acme",
      search: { historyPage: "2" },
      replace: true
    });

    wrapper.vm.pagination.onPageSizeChange(25);
    await flush();
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: "/w/acme",
      search: { historyPageSize: "25" },
      replace: true
    });
  });

  it("syncs pagination when URL search changes after mount", async () => {
    const wrapper = mountHarness({
      pageKey: "historyPage",
      pageSizeKey: "historyPageSize",
      defaultPageSize: 10,
      pageSizeOptions: [10, 25, 50]
    });
    await flush();

    routerSearch.value = {
      historyPage: "4",
      historyPageSize: "50"
    };
    await flush();

    expect(wrapper.vm.pagination.page.value).toBe(4);
    expect(wrapper.vm.pagination.pageSize.value).toBe(50);
  });
});
