import { computed, onMounted, reactive, ref } from "vue";
import { api } from "../../services/api/index.js";

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
  const entries = ref([]);
  const loading = ref(false);
  const error = ref("");
  const page = ref(1);
  const pageSize = ref(20);
  const total = ref(0);
  const totalPages = ref(1);
  const statusFilter = ref("");
  const selectedConversation = ref(null);
  const messages = ref([]);
  const messagesLoading = ref(false);
  const messagesError = ref("");
  const exportBusy = ref(false);

  const hasConversationSelected = computed(() => Number(selectedConversation.value?.id) > 0);

  async function loadConversations() {
    loading.value = true;
    error.value = "";
    try {
      const response = await api.workspace.listAiTranscripts({
        page: page.value,
        pageSize: pageSize.value,
        status: statusFilter.value || undefined
      });

      entries.value = Array.isArray(response?.entries) ? response.entries : [];
      total.value = Number(response?.total || 0);
      totalPages.value = Math.max(1, Number(response?.totalPages || 1));
      page.value = Math.max(1, Number(response?.page || 1));
      pageSize.value = Math.max(1, Number(response?.pageSize || 20));

      if (entries.value.length < 1) {
        selectedConversation.value = null;
        messages.value = [];
      } else if (!hasConversationSelected.value) {
        await selectConversation(entries.value[0]);
      }
    } catch (loadError) {
      error.value = String(loadError?.message || "Unable to load transcript conversations.");
    } finally {
      loading.value = false;
    }
  }

  async function selectConversation(conversation) {
    const conversationId = Number(conversation?.id);
    if (!Number.isInteger(conversationId) || conversationId < 1) {
      return;
    }

    selectedConversation.value = conversation;
    messagesLoading.value = true;
    messagesError.value = "";
    try {
      const response = await api.workspace.getAiTranscriptMessages(conversationId, {
        page: 1,
        pageSize: 500
      });
      selectedConversation.value = response?.conversation || conversation;
      messages.value = Array.isArray(response?.entries) ? response.entries : [];
    } catch (loadError) {
      messages.value = [];
      messagesError.value = String(loadError?.message || "Unable to load conversation messages.");
    } finally {
      messagesLoading.value = false;
    }
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
    await loadConversations();
  }

  async function goNextPage() {
    if (page.value >= totalPages.value || loading.value) {
      return;
    }
    page.value += 1;
    await loadConversations();
  }

  async function setPageSize(nextPageSize) {
    const parsed = Number(nextPageSize);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return;
    }

    pageSize.value = parsed;
    page.value = 1;
    await loadConversations();
  }

  async function setStatusFilter(nextStatus) {
    statusFilter.value = String(nextStatus || "");
    page.value = 1;
    await loadConversations();
  }

  onMounted(async () => {
    await loadConversations();
  });

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
