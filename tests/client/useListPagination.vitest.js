import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { describe, expect, it } from "vitest";
import { useListPagination } from "../../src/composables/useListPagination.js";

function mountHarness(options) {
  const Harness = defineComponent({
    name: "UseListPaginationHarness",
    setup() {
      return useListPagination(options);
    },
    template: "<div />"
  });

  return mount(Harness);
}

describe("useListPagination", () => {
  it("initializes page and normalizes page size", () => {
    const wrapper = mountHarness({
      initialPageSize: 0,
      defaultPageSize: 10
    });

    expect(wrapper.vm.page).toBe(1);
    expect(wrapper.vm.pageSize).toBe(1);
  });

  it("handles previous/next with loading and bounds", () => {
    let isLoading = false;
    let totalPages = 3;

    const wrapper = mountHarness({
      initialPageSize: 10,
      defaultPageSize: 10,
      getIsLoading: () => isLoading,
      getTotalPages: () => totalPages
    });

    wrapper.vm.goPrevious();
    expect(wrapper.vm.page).toBe(1);

    wrapper.vm.goNext();
    expect(wrapper.vm.page).toBe(2);

    isLoading = true;
    wrapper.vm.goNext();
    expect(wrapper.vm.page).toBe(2);

    isLoading = false;
    totalPages = 2;
    wrapper.vm.goNext();
    expect(wrapper.vm.page).toBe(2);

    wrapper.vm.page = 3;
    wrapper.vm.goNext({ totalPages: 3 });
    expect(wrapper.vm.page).toBe(3);

    wrapper.vm.page = 1;
    totalPages = null;
    wrapper.vm.goNext();
    expect(wrapper.vm.page).toBe(1);
  });

  it("updates page size and resets to first page", () => {
    const wrapper = mountHarness({
      initialPageSize: 10,
      defaultPageSize: 10
    });

    wrapper.vm.page = 2;
    wrapper.vm.onPageSizeChange(undefined);
    expect(wrapper.vm.page).toBe(1);
    expect(wrapper.vm.pageSize).toBe(10);

    wrapper.vm.page = 2;
    wrapper.vm.onPageSizeChange(25);
    expect(wrapper.vm.page).toBe(1);
    expect(wrapper.vm.pageSize).toBe(25);
  });

  it("resets to first page explicitly", () => {
    const wrapper = mountHarness({
      initialPageSize: 10,
      defaultPageSize: 10
    });

    wrapper.vm.page = 3;
    wrapper.vm.resetToFirstPage();
    expect(wrapper.vm.page).toBe(1);
  });
});
