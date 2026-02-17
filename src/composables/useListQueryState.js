import { computed } from "vue";
import { normalizePage } from "../utils/pagination";

export function useListQueryState(query, { resolveTotalPages } = {}) {
  const total = computed(() => Number(query?.data?.value?.total) || 0);
  const totalPages = computed(() => {
    const source = query?.data?.value;
    const rawTotalPages = typeof resolveTotalPages === "function" ? resolveTotalPages(source) : source?.totalPages;
    return normalizePage(rawTotalPages, 1);
  });
  const loading = computed(() => Boolean(query?.isPending?.value || query?.isFetching?.value));

  return {
    total,
    totalPages,
    loading
  };
}
