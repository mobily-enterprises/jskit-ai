import { ref } from "vue";
import { describe, expect, it } from "vitest";
import { useListQueryState } from "../../src/composables/useListQueryState.js";

function createQueryState() {
  return {
    data: ref(null),
    isPending: ref(false),
    isFetching: ref(false)
  };
}

describe("useListQueryState", () => {
  it("returns safe defaults when query data is unavailable", () => {
    const query = createQueryState();
    const state = useListQueryState(query);

    expect(state.total.value).toBe(0);
    expect(state.totalPages.value).toBe(1);
    expect(state.loading.value).toBe(false);
  });

  it("derives total, total pages, and loading flags from query", () => {
    const query = createQueryState();
    const state = useListQueryState(query);

    query.data.value = {
      total: "12",
      totalPages: 4
    };
    query.isPending.value = true;

    expect(state.total.value).toBe(12);
    expect(state.totalPages.value).toBe(4);
    expect(state.loading.value).toBe(true);

    query.isPending.value = false;
    query.isFetching.value = true;
    expect(state.loading.value).toBe(true);

    query.isFetching.value = false;
    expect(state.loading.value).toBe(false);
  });

  it("supports custom total pages resolver with normalization", () => {
    const query = createQueryState();
    const state = useListQueryState(query, {
      resolveTotalPages: (data) => data?.paging?.pages
    });

    query.data.value = {
      total: 7,
      paging: {
        pages: 5
      }
    };
    expect(state.total.value).toBe(7);
    expect(state.totalPages.value).toBe(5);

    query.data.value = {
      total: 7,
      paging: {
        pages: 0
      }
    };
    expect(state.totalPages.value).toBe(1);
  });
});
