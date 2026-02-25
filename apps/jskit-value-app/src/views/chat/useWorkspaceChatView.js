import { ref, watch } from "vue";
import { useRouterState } from "@tanstack/vue-router";
import { useChatView } from "../../modules/chat/runtime.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

export function useWorkspaceChatView() {
  const chat = useChatView();
  const routerSearch = useRouterState({
    select: (state) => state.location.search
  });
  const processedHandoffKey = ref("");

  watch(
    () => [routerSearch.value?.threadId, routerSearch.value?.dmPublicChatId],
    async ([rawThreadId, rawDmPublicChatId]) => {
      const threadId = toPositiveInteger(rawThreadId);
      const dmPublicChatId = normalizeText(rawDmPublicChatId).toLowerCase();
      const handoffKey = `${threadId || ""}:${dmPublicChatId || ""}`;

      if (!handoffKey || handoffKey === ":") {
        return;
      }
      if (handoffKey === processedHandoffKey.value) {
        return;
      }

      processedHandoffKey.value = handoffKey;
      try {
        if (threadId) {
          await chat.actions.selectThread(threadId);
          return;
        }

        if (dmPublicChatId) {
          await chat.actions.ensureDmThread(dmPublicChatId);
        }
      } catch {
        // The chat runtime already exposes transport and domain errors in view state.
      }
    },
    { immediate: true }
  );

  return chat;
}
