<script setup>
import { computed, ref, toRef } from "vue";
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";
import { useAssistantConversation } from "../composables/useAssistantConversation.js";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  conversationId: { type: String, required: true },
  endpoint: { type: String, default: "" },
  surfaceId: { type: String, default: "" },
  hostSurfaceId: { type: String, default: "" },
  workspaceSlug: { type: String, default: undefined },
  actorKey: { type: String, default: undefined },
  api: { type: Object, default: null },
  active: { type: Boolean, default: true },
  clearDraftOn: { type: String, default: undefined, validator: value => ["dispatch", "accepted"].includes(value) },
  // Unset texts follow the active language; an application's own text is shown as given.
  assistantLabel: { type: String, default: undefined },
  welcomeMessage: { type: String, default: undefined },
  placeholder: { type: String, default: undefined },
  layout: { type: String, default: "compact", validator: value => ["page", "compact"].includes(value) },
  data: { type: Object, default: undefined },
  attachments: { type: Object, default: null },
  suggestions: { type: Object, default: null },
  models: { type: Object, default: null },
  questions: { type: [Boolean, Object], default: null },
  goal: { type: [Boolean, Object], default: null },
  avatarSize: { type: String, default: "compact", validator: (value) => ["hidden", "compact", "standard", "large"].includes(value) }
});
const emit = defineEmits(["update:avatarSize"]);
const { t } = useJskitText();
const assistantLabelText = computed(() => props.assistantLabel ?? t("jskit.assistant.runtime.conversation.assistantLabel"));
const binding = useAssistantConversation({
  conversationId: toRef(props, "conversationId"), endpoint: toRef(props, "endpoint"),
  surfaceId: toRef(props, "surfaceId"), hostSurfaceId: toRef(props, "hostSurfaceId"),
  workspaceSlug: () => props.workspaceSlug, active: toRef(props, "active"),
  actorKey: toRef(props, "actorKey"), api: props.api, clearDraftOn: props.clearDraftOn,
  data: toRef(props, "data"),
  attachments: toRef(props, "attachments"), suggestions: toRef(props, "suggestions"), models: toRef(props, "models"),
  questions: toRef(props, "questions"), goal: toRef(props, "goal"),
  presentation: computed(() => ({ assistantLabel: assistantLabelText.value,
    welcomeMessage: props.welcomeMessage ?? t("jskit.assistant.runtime.conversation.welcomeMessage"),
    placeholder: props.placeholder ?? t("jskit.assistant.runtime.conversation.placeholder"), layout: props.layout }))
});
const conversation = ref(null);
defineExpose({ focus: () => conversation.value?.focus(), runtime: binding.runtime });
</script>

<template>
  <AssistantConversationElement
    ref="conversation" :adapter="binding.adapter.value" :label="assistantLabelText" :avatar-size="avatarSize"
    class="assistant-client-conversation" @update:avatar-size="emit('update:avatarSize', $event)"
  >
    <template v-for="name in Object.keys($slots).filter(name => name !== 'composer-feedback')" #[name]="scope">
      <slot :name="name" v-bind="scope" :runtime="binding.runtime.value" />
    </template>
    <template #composer-feedback>
      <slot name="composer-feedback" :runtime="binding.runtime.value" />
    </template>
  </AssistantConversationElement>
</template>

<style scoped>
.assistant-client-conversation { flex: 1 1 auto; height: 100%; min-height: 0; min-width: 0; }
</style>
