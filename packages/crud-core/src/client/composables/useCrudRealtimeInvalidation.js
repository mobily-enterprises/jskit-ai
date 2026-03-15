import { useQueryClient } from "@tanstack/vue-query";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import {
  crudScopeQueryKey,
  requireCrudNamespace,
  resolveCrudRecordChangedEvent
} from "./crudClientSupportHelpers.js";

function useCrudRealtimeInvalidation(
  namespace = "",
  {
    event = "",
    enabled = true,
    matches = null,
    queryKey = null
  } = {}
) {
  const normalizedNamespace = requireCrudNamespace(namespace, {
    context: "useCrudRealtimeInvalidation"
  });
  const queryClient = useQueryClient();
  const resolvedEvent = String(event || "").trim() || resolveCrudRecordChangedEvent(normalizedNamespace);
  const resolvedQueryKey = Array.isArray(queryKey) && queryKey.length > 0 ? queryKey : crudScopeQueryKey(normalizedNamespace);

  return useRealtimeEvent({
    event: resolvedEvent,
    enabled,
    matches,
    onEvent: async () => {
      await queryClient.invalidateQueries({
        queryKey: resolvedQueryKey
      });
    }
  });
}

export { useCrudRealtimeInvalidation };
