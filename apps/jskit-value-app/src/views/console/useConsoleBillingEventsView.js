import { computed, reactive, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { useUrlListPagination } from "../../composables/useUrlListPagination.js";
import { api } from "../../services/api/index.js";

const CONSOLE_BILLING_EVENTS_QUERY_KEY_PREFIX = ["console-billing-events"];
const CONSOLE_BILLING_EVENTS_PAGE_SIZE_OPTIONS = [25, 50, 100];

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

function stringifyDetails(value) {
  if (value == null) {
    return "{}";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

export function useConsoleBillingEventsView() {
  const { handleUnauthorizedError } = useAuthGuard();
  const pagination = useUrlListPagination({
    pageKey: "page",
    pageSizeKey: "pageSize",
    initialPageSize: CONSOLE_BILLING_EVENTS_PAGE_SIZE_OPTIONS[0],
    defaultPageSize: CONSOLE_BILLING_EVENTS_PAGE_SIZE_OPTIONS[0],
    pageSizeOptions: CONSOLE_BILLING_EVENTS_PAGE_SIZE_OPTIONS
  });
  const workspaceSlugFilter = ref("");
  const userIdFilter = ref("");
  const billableEntityIdFilter = ref("");
  const operationKeyFilter = ref("");
  const providerEventIdFilter = ref("");
  const sourceFilter = ref("");

  const eventsQuery = useQuery({
    queryKey: computed(() => [
      ...CONSOLE_BILLING_EVENTS_QUERY_KEY_PREFIX,
      {
        page: pagination.page.value,
        pageSize: pagination.pageSize.value,
        workspaceSlug: workspaceSlugFilter.value,
        userId: userIdFilter.value,
        billableEntityId: billableEntityIdFilter.value,
        operationKey: operationKeyFilter.value,
        providerEventId: providerEventIdFilter.value,
        source: sourceFilter.value
      }
    ]),
    queryFn: () =>
      api.console.listBillingEvents({
        page: pagination.page.value,
        pageSize: pagination.pageSize.value,
        workspaceSlug: workspaceSlugFilter.value || undefined,
        userId: userIdFilter.value || undefined,
        billableEntityId: billableEntityIdFilter.value || undefined,
        operationKey: operationKeyFilter.value || undefined,
        providerEventId: providerEventIdFilter.value || undefined,
        source: sourceFilter.value || undefined
      }),
    placeholderData: (previous) => previous
  });

  const entries = computed(() => (Array.isArray(eventsQuery.data.value?.entries) ? eventsQuery.data.value.entries : []));
  const loading = computed(() => Boolean(eventsQuery.isPending.value || eventsQuery.isFetching.value));
  const error = useQueryErrorMessage({
    query: eventsQuery,
    handleUnauthorizedError,
    mapError: (nextError) => String(nextError?.message || "Unable to load billing events.")
  });
  const hasMore = computed(() => Boolean(eventsQuery.data.value?.hasMore));

  async function refresh() {
    await eventsQuery.refetch();
  }

  async function applyFilters() {
    pagination.page.value = 1;
    await refresh();
  }

  function setPageSize(nextPageSize) {
    pagination.onPageSizeChange(nextPageSize);
  }

  function goPreviousPage() {
    pagination.goPrevious({ isLoading: loading.value });
  }

  function goNextPage() {
    if (loading.value || !hasMore.value) {
      return;
    }

    pagination.page.value += 1;
  }

  return {
    meta: {
      pageSizeOptions: CONSOLE_BILLING_EVENTS_PAGE_SIZE_OPTIONS,
      sourceOptions: [
        { title: "All sources", value: "" },
        { title: "Idempotency requests", value: "idempotency" },
        { title: "Checkout sessions", value: "checkout_session" },
        { title: "Subscriptions", value: "subscription" },
        { title: "Invoices", value: "invoice" },
        { title: "Payments", value: "payment" },
        { title: "Payment method sync", value: "payment_method_sync" },
        { title: "Webhooks", value: "webhook" },
        { title: "Outbox jobs", value: "outbox_job" },
        { title: "Remediations", value: "remediation" },
        { title: "Reconciliation runs", value: "reconciliation_run" }
      ],
      formatDateTime,
      stringifyDetails
    },
    state: reactive({
      entries,
      loading,
      error,
      hasMore,
      page: pagination.page,
      pageSize: pagination.pageSize,
      workspaceSlugFilter,
      userIdFilter,
      billableEntityIdFilter,
      operationKeyFilter,
      providerEventIdFilter,
      sourceFilter
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
