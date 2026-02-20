import { computed, reactive, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../services/api/index.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";
import {
  workspaceAiTranscriptMessagesQueryKey,
  workspaceAiTranscriptsListQueryKey
} from "../../features/aiTranscripts/queryKeys.js";

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

function formatTranscriptMode(value) {
  const mode = String(value || "standard").trim().toLowerCase();
  if (mode === "restricted") {
    return "Restricted";
  }
  if (mode === "disabled") {
    return "Disabled";
  }
  return "Standard";
}

function summarizeContent(value) {
  const text = String(value || "");
  if (!text) {
    return "No content stored by policy.";
  }

  if (text.length <= 280) {
    return text;
  }

  return `${text.slice(0, 280)}...`;
}

export function useWorkspaceTranscriptsView() {
  const workspaceStore = useWorkspaceStore();
  const page = ref(1);
  const pageSize = ref(20);
  const statusFilter = ref("");
  const selectedConversationId = ref(0);
  const messagesError = ref("");
  const exportBusy = ref(false);

  const workspaceSlug = computed(() => {
    return String(workspaceStore.activeWorkspace?.slug || workspaceStore.activeWorkspaceSlug || "").trim();
  });

  const conversationsQuery = useQuery({
    queryKey: computed(() =>
      workspaceAiTranscriptsListQueryKey(workspaceSlug.value, {
        page: page.value,
        pageSize: pageSize.value,
        status: statusFilter.value
      })
    ),
    queryFn: () =>
      api.workspace.listAiTranscripts({
        page: page.value,
        pageSize: pageSize.value,
        status: statusFilter.value || undefined
      }),
    enabled: computed(() => Boolean(workspaceSlug.value))
  });

  const entries = computed(() => {
    return Array.isArray(conversationsQuery.data.value?.entries) ? conversationsQuery.data.value.entries : [];
  });

  const total = computed(() => Number(conversationsQuery.data.value?.total || 0));
  const totalPages = computed(() => Math.max(1, Number(conversationsQuery.data.value?.totalPages || 1)));
  const loading = computed(() => conversationsQuery.isFetching.value);
  const error = computed(() => String(conversationsQuery.error.value?.message || ""));

  watch(
    () => conversationsQuery.data.value,
    (response) => {
      const normalizedPage = Number(response?.page);
      const normalizedPageSize = Number(response?.pageSize);

      if (Number.isInteger(normalizedPage) && normalizedPage > 0 && normalizedPage !== page.value) {
        page.value = normalizedPage;
      }
      if (Number.isInteger(normalizedPageSize) && normalizedPageSize > 0 && normalizedPageSize !== pageSize.value) {
        pageSize.value = normalizedPageSize;
      }
    }
  );

  watch(
    entries,
    (nextEntries) => {
      if (nextEntries.length < 1) {
        selectedConversationId.value = 0;
        return;
      }

      const selectedId = Number(selectedConversationId.value);
      const hasSelectedConversation = nextEntries.some((entry) => Number(entry?.id) === selectedId);
      if (!hasSelectedConversation) {
        selectedConversationId.value = Number(nextEntries[0]?.id) || 0;
      }
    },
    {
      immediate: true
    }
  );

  const messagesQuery = useQuery({
    queryKey: computed(() =>
      workspaceAiTranscriptMessagesQueryKey(workspaceSlug.value, selectedConversationId.value, {
        page: 1,
        pageSize: 500
      })
    ),
    queryFn: () =>
      api.workspace.getAiTranscriptMessages(selectedConversationId.value, {
        page: 1,
        pageSize: 500
      }),
    enabled: computed(() => Boolean(workspaceSlug.value) && Number(selectedConversationId.value) > 0)
  });

  watch(
    () => messagesQuery.error.value,
    (loadError) => {
      messagesError.value = loadError ? String(loadError?.message || "Unable to load conversation messages.") : "";
    },
    {
      immediate: true
    }
  );

  const selectedConversation = computed(() => {
    const selectedId = Number(selectedConversationId.value);
    if (!Number.isInteger(selectedId) || selectedId < 1) {
      return null;
    }

    const fromEntries = entries.value.find((entry) => Number(entry?.id) === selectedId) || null;
    if (fromEntries) {
      return fromEntries;
    }

    const fromMessages = messagesQuery.data.value?.conversation;
    if (Number(fromMessages?.id) === selectedId) {
      return fromMessages;
    }

    return null;
  });

  const messages = computed(() => {
    return Array.isArray(messagesQuery.data.value?.entries) ? messagesQuery.data.value.entries : [];
  });
  const messagesLoading = computed(() => Number(selectedConversationId.value) > 0 && messagesQuery.isFetching.value);

  async function loadConversations() {
    await conversationsQuery.refetch();
    if (Number(selectedConversationId.value) > 0) {
      await messagesQuery.refetch();
    }
  }

  async function selectConversation(conversation) {
    const conversationId = Number(conversation?.id);
    if (!Number.isInteger(conversationId) || conversationId < 1) {
      return;
    }

    messagesError.value = "";
    if (conversationId === Number(selectedConversationId.value)) {
      await messagesQuery.refetch();
      return;
    }

    selectedConversationId.value = conversationId;
  }

  async function exportConversation() {
    const conversationId = Number(selectedConversation.value?.id);
    if (!Number.isInteger(conversationId) || conversationId < 1 || exportBusy.value) {
      return;
    }

    exportBusy.value = true;
    messagesError.value = "";
    try {
      const response = await api.workspace.exportAiTranscript(conversationId, {
        format: "json",
        limit: 10000
      });
      const payload = JSON.stringify(response, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `workspace-transcript-${conversationId}.json`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (exportError) {
      messagesError.value = String(exportError?.message || "Unable to export transcript.");
    } finally {
      exportBusy.value = false;
    }
  }

  async function goPreviousPage() {
    if (page.value <= 1 || loading.value) {
      return;
    }
    page.value -= 1;
  }

  async function goNextPage() {
    if (page.value >= totalPages.value || loading.value) {
      return;
    }
    page.value += 1;
  }

  async function setPageSize(nextPageSize) {
    const parsed = Number(nextPageSize);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return;
    }

    pageSize.value = parsed;
    page.value = 1;
  }

  async function setStatusFilter(nextStatus) {
    statusFilter.value = String(nextStatus || "");
    page.value = 1;
  }

  return {
    meta: {
      pageSizeOptions: [20, 50, 100],
      statusOptions: [
        { title: "All statuses", value: "" },
        { title: "Active", value: "active" },
        { title: "Completed", value: "completed" },
        { title: "Failed", value: "failed" },
        { title: "Aborted", value: "aborted" }
      ],
      formatDateTime,
      formatTranscriptMode,
      summarizeContent
    },
    state: reactive({
      entries,
      loading,
      error,
      page,
      pageSize,
      total,
      totalPages,
      statusFilter,
      selectedConversation,
      messages,
      messagesLoading,
      messagesError,
      exportBusy
    }),
    actions: {
      loadConversations,
      selectConversation,
      exportConversation,
      goPreviousPage,
      goNextPage,
      setPageSize,
      setStatusFilter
    }
  };
}
