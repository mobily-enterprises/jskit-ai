import { computed, reactive, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../services/api/index.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";
import { workspaceBillingTimelineQueryKey } from "../../features/workspaceAdmin/queryKeys.js";

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

function toTitleCase(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function useWorkspaceBillingView() {
  const workspaceStore = useWorkspaceStore();
  const page = ref(1);
  const pageSize = ref(20);
  const sourceFilter = ref("");
  const operationKeyFilter = ref("");
  const providerEventIdFilter = ref("");

  const workspaceSlug = computed(() => {
    return String(workspaceStore.activeWorkspace?.slug || workspaceStore.activeWorkspaceSlug || "").trim();
  });

  const timelineQuery = useQuery({
    queryKey: computed(() =>
      workspaceBillingTimelineQueryKey(workspaceSlug.value, {
        page: page.value,
        pageSize: pageSize.value,
        source: sourceFilter.value,
        operationKey: operationKeyFilter.value,
        providerEventId: providerEventIdFilter.value
      })
    ),
    queryFn: () =>
      api.billing.getTimeline({
        page: page.value,
        pageSize: pageSize.value,
        source: sourceFilter.value || undefined,
        operationKey: operationKeyFilter.value || undefined,
        providerEventId: providerEventIdFilter.value || undefined
      }),
    enabled: computed(() => Boolean(workspaceSlug.value))
  });

  const entries = computed(() => (Array.isArray(timelineQuery.data.value?.entries) ? timelineQuery.data.value.entries : []));
  const loading = computed(() => timelineQuery.isFetching.value);
  const error = computed(() => String(timelineQuery.error.value?.message || ""));
  const hasMore = computed(() => Boolean(timelineQuery.data.value?.hasMore));

  async function refresh() {
    await timelineQuery.refetch();
  }

  async function applyFilters() {
    page.value = 1;
    await refresh();
  }

  async function setPageSize(nextPageSize) {
    const parsed = Number(nextPageSize);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return;
    }

    pageSize.value = parsed;
    page.value = 1;
  }

  async function goPreviousPage() {
    if (loading.value || page.value <= 1) {
      return;
    }

    page.value -= 1;
  }

  async function goNextPage() {
    if (loading.value || !hasMore.value) {
      return;
    }

    page.value += 1;
  }

  return {
    meta: {
      pageSizeOptions: [20, 50, 100],
      sourceOptions: [
        { title: "All sources", value: "" },
        { title: "Requests", value: "idempotency" },
        { title: "Checkout sessions", value: "checkout_session" },
        { title: "Subscriptions", value: "subscription" },
        { title: "Invoices", value: "invoice" },
        { title: "Payments", value: "payment" },
        { title: "Payment method sync", value: "payment_method_sync" },
        { title: "Webhooks", value: "webhook" },
        { title: "Outbox jobs", value: "outbox_job" },
        { title: "Remediations", value: "remediation" }
      ],
      formatDateTime,
      toTitleCase
    },
    state: reactive({
      entries,
      loading,
      error,
      page,
      pageSize,
      hasMore,
      sourceFilter,
      operationKeyFilter,
      providerEventIdFilter
    }),
    actions: {
      refresh,
      applyFilters,
      setPageSize,
      goPreviousPage,
      goNextPage
    }
  };
}
