import { computed, reactive, ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { mapSocialError, socialScopeQueryKey } from "@jskit-ai/social-contracts";
import { api } from "../../platform/http/api/index.js";
import { useAuthGuard } from "../../modules/auth/useAuthGuard.js";
import { useWorkspaceStore } from "../../app/state/workspaceStore.js";

const RULE_SCOPE_OPTIONS = Object.freeze([
  { title: "Domain", value: "domain" },
  { title: "Actor", value: "actor" }
]);

const RULE_DECISION_OPTIONS = Object.freeze([
  { title: "Block", value: "block" },
  { title: "Mute", value: "mute" },
  { title: "Allow", value: "allow" }
]);

function normalizeText(value) {
  return String(value || "").trim();
}

export function useSocialModerationView() {
  const queryClient = useQueryClient();
  const workspaceStore = useWorkspaceStore();
  const { handleUnauthorizedError } = useAuthGuard();

  const ruleScopeFilter = ref("");
  const ruleScope = ref("domain");
  const decision = ref("block");
  const domain = ref("");
  const actorUri = ref("");
  const reason = ref("");
  const formError = ref("");
  const noticeMessage = ref("");

  const workspaceSlug = computed(() => normalizeText(workspaceStore.activeWorkspaceSlug));

  const rulesQuery = useQuery({
    queryKey: computed(() => [...socialScopeQueryKey(workspaceSlug.value), "moderation", ruleScopeFilter.value || "all"]),
    enabled: computed(() => Boolean(workspaceSlug.value)),
    queryFn: async () => {
      try {
        return await api.social.listModerationRules({
          ruleScope: normalizeText(ruleScopeFilter.value) || undefined
        });
      } catch (error) {
        handleUnauthorizedError(error);
        throw error;
      }
    }
  });

  async function invalidateRules() {
    await queryClient.invalidateQueries({
      queryKey: [...socialScopeQueryKey(workspaceSlug.value), "moderation"]
    });
  }

  const createRuleMutation = useMutation({
    mutationFn: async (payload) => api.social.createModerationRule(payload),
    onSuccess: invalidateRules,
    onError(error) {
      handleUnauthorizedError(error);
    }
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async ({ ruleId }) => api.social.deleteModerationRule(ruleId),
    onSuccess: invalidateRules,
    onError(error) {
      handleUnauthorizedError(error);
    }
  });

  const rules = computed(() => {
    const source = Array.isArray(rulesQuery.data.value?.items) ? rulesQuery.data.value.items : [];
    return source;
  });

  async function submitRule() {
    formError.value = "";
    noticeMessage.value = "";

    const nextScope = normalizeText(ruleScope.value).toLowerCase();
    const nextDecision = normalizeText(decision.value).toLowerCase();
    const nextDomain = normalizeText(domain.value).toLowerCase();
    const nextActorUri = normalizeText(actorUri.value);
    const nextReason = normalizeText(reason.value);

    if (nextScope !== "domain" && nextScope !== "actor") {
      formError.value = "Select a valid rule scope.";
      return;
    }

    if (!["block", "mute", "allow"].includes(nextDecision)) {
      formError.value = "Select a valid moderation decision.";
      return;
    }

    if (nextScope === "domain" && !nextDomain) {
      formError.value = "Domain is required for domain rules.";
      return;
    }

    if (nextScope === "actor" && !nextActorUri) {
      formError.value = "Actor URI is required for actor rules.";
      return;
    }

    try {
      await createRuleMutation.mutateAsync({
        ruleScope: nextScope,
        decision: nextDecision,
        domain: nextScope === "domain" ? nextDomain : undefined,
        actorUri: nextScope === "actor" ? nextActorUri : undefined,
        reason: nextReason || undefined
      });

      domain.value = "";
      actorUri.value = "";
      reason.value = "";
      noticeMessage.value = "Moderation rule saved.";
    } catch (error) {
      formError.value = mapSocialError(error, "Unable to create moderation rule.").message;
    }
  }

  async function deleteRule(ruleId) {
    formError.value = "";
    noticeMessage.value = "";
    try {
      await deleteRuleMutation.mutateAsync({
        ruleId
      });
      noticeMessage.value = "Moderation rule deleted.";
    } catch (error) {
      formError.value = mapSocialError(error, "Unable to delete moderation rule.").message;
    }
  }

  return {
    meta: {
      ruleScopeOptions: RULE_SCOPE_OPTIONS,
      decisionOptions: RULE_DECISION_OPTIONS
    },
    state: reactive({
      workspaceSlug,
      ruleScopeFilter,
      ruleScope,
      decision,
      domain,
      actorUri,
      reason,
      formError,
      noticeMessage,
      rulesQuery,
      rules,
      createRuleMutation,
      deleteRuleMutation
    }),
    actions: {
      submitRule,
      deleteRule,
      async refresh() {
        await rulesQuery.refetch();
      }
    }
  };
}
