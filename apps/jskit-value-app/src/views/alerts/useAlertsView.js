import { computed, onMounted, reactive, ref } from "vue";
import { useAlertsStore } from "../../app/state/alertsStore.js";
import { useAuthGuard } from "../../modules/auth/useAuthGuard.js";

const PAGE_SIZE_OPTIONS = Object.freeze([20, 50, 100]);

function normalizePositiveInteger(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function normalizePageSize(value) {
  const parsed = normalizePositiveInteger(value, PAGE_SIZE_OPTIONS[0]);
  if (!PAGE_SIZE_OPTIONS.includes(parsed)) {
    return PAGE_SIZE_OPTIONS[0];
  }

  return parsed;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

function toErrorMessage(error, fallback) {
  return String(error?.message || fallback);
}

function isEntryUnread(entry, readThroughAlertId) {
  const id = Number(entry?.id || 0);
  const threshold = Number(readThroughAlertId || 0);
  return id > threshold;
}

export function useAlertsView() {
  const alertsStore = useAlertsStore();
  const { handleUnauthorizedError } = useAuthGuard();

  const page = ref(1);
  const pageSize = ref(PAGE_SIZE_OPTIONS[0]);
  const entries = ref([]);
  const total = ref(0);
  const totalPages = ref(1);
  const loading = ref(false);
  const error = ref("");

  const unreadCount = computed(() => Number(alertsStore.unreadCount || 0));
  const readThroughAlertId = computed(() => alertsStore.readThroughAlertId);
  const hasEntries = computed(() => entries.value.length > 0);
  const entriesWithReadStatus = computed(() =>
    entries.value.map((entry) => ({
      ...entry,
      isUnread: isEntryUnread(entry, readThroughAlertId.value)
    }))
  );

  async function loadPage(nextPage = page.value) {
    loading.value = true;
    error.value = "";

    try {
      const response = await alertsStore.listPage({
        page: normalizePositiveInteger(nextPage, 1),
        pageSize: normalizePageSize(pageSize.value)
      });

      entries.value = Array.isArray(response?.entries) ? response.entries : [];
      page.value = normalizePositiveInteger(response?.page, 1);
      pageSize.value = normalizePageSize(response?.pageSize);
      total.value = Math.max(0, Number(response?.total) || 0);
      totalPages.value = Math.max(1, Number(response?.totalPages) || 1);
      return response;
    } catch (nextError) {
      if (await handleUnauthorizedError(nextError)) {
        return null;
      }

      error.value = toErrorMessage(nextError, "Unable to load alerts.");
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function hardNavigate(targetUrl) {
    if (typeof window !== "undefined" && window.location && typeof window.location.assign === "function") {
      window.location.assign(targetUrl);
    }
  }

  async function openAlert(entry) {
    error.value = "";

    try {
      await alertsStore.handleAlertClick(entry, hardNavigate);
    } catch (nextError) {
      if (await handleUnauthorizedError(nextError)) {
        return;
      }

      error.value = toErrorMessage(nextError, "Unable to open alert.");
    }
  }

  async function refresh() {
    await loadPage(page.value);
  }

  async function goPrevious() {
    if (page.value <= 1 || loading.value) {
      return;
    }

    await loadPage(page.value - 1);
  }

  async function goNext() {
    if (page.value >= totalPages.value || loading.value) {
      return;
    }

    await loadPage(page.value + 1);
  }

  async function onPageSizeChange(value) {
    const normalized = normalizePageSize(value);
    if (normalized === pageSize.value) {
      return;
    }

    pageSize.value = normalized;
    page.value = 1;
    await loadPage(1);
  }

  onMounted(async () => {
    await alertsStore.refreshPreview({
      silent: true,
      broadcast: false
    }).catch(() => {});
    await loadPage(1);
  });

  return {
    meta: {
      pageSizeOptions: PAGE_SIZE_OPTIONS,
      formatDateTime
    },
    state: reactive({
      entries: entriesWithReadStatus,
      hasEntries,
      page,
      pageSize,
      total,
      totalPages,
      unreadCount,
      loading,
      error
    }),
    actions: {
      refresh,
      openAlert,
      goPrevious,
      goNext,
      onPageSizeChange
    }
  };
}

