<script setup>
import { computed, defineComponent, effectScope, inject, nextTick, onMounted, onScopeDispose, ref, shallowRef } from "vue";
import { useAssistantAttachments } from "@jskit-ai/assistant-core/client/conversation-attachments";
import { useAssistantSuggestions } from "@jskit-ai/assistant-core/client/conversation-suggestions";
import AssistantConversationClientElement from "../../src/client/components/AssistantConversationClientElement.vue";
import { useAssistantConversation, useAssistantConversationFactory } from "../../src/client/composables/useAssistantConversation.js";
import DraftConversation from "./DraftConversation.vue";

const { placement, socket } = inject("fixture");
const factoryScope = effectScope();
const acquireConversation = factoryScope.run(() => useAssistantConversationFactory());
const fixtureOptions = new URLSearchParams(window.location.search);
const conversationId = ref(fixtureOptions.has("unresolved") ? "" : "chat:1");
const visible = ref(true);
const multiple = ref(false);
const mirror = ref(false);
const conversation = ref(null);
const voice = shallowRef(null);
const acceptedDraft = fixtureOptions.has("acceptedDraft");
const draftWhileLoading = fixtureOptions.has("draftWhileLoading");
const presentation = ref({});
const dispatches = [];
const recordDispatch = messageId => dispatches.push(messageId);
const eventReaders = ref([]);
const readerEvents = [];
const EventReader = defineComponent({
  props: { reader: { type: Object, required: true } },
  setup(props) {
    const binding = useAssistantConversation({
      conversationId, active: () => props.reader.active !== false,
      goal: () => props.reader.goal === true,
      onEvent(event) {
        const streaming = binding.runtime.value?.snapshot.value?.streaming;
        readerEvents.push({ reader: props.reader.id, type: event.type, marker: event.marker,
          revision: streaming?.revision ?? null, text: streaming?.messages.at(-1)?.text || "" });
        if (props.reader.id === "first" && event.failure === "throw") throw new Error("Fixture presentation failed.");
        if (props.reader.id === "first" && event.failure === "reject") return Promise.reject(new Error("Fixture refresh failed."));
      }
    });
    return () => null;
  }
});
const authoredData = ref(undefined);
const attachmentsEnabled = ref(false);
const attachmentActor = ref("42");
const uploads = [];
const deleted = [];
const acknowledged = [];
const heldUploads = [];
const attachments = useAssistantAttachments({
  sessionId: computed(() => `${attachmentActor.value}/${conversationId.value}`),
  canUpload: attachmentsEnabled,
  uploadAttachment(sessionId, file, { onProgress }) {
    const receipt = { attachmentId: crypto.randomUUID(), fileName: file.name, size: file.size, sessionId };
    uploads.push({ sessionId, fileName: file.name, attachmentId: receipt.attachmentId });
    onProgress({ bytesSent: file.size / 2, totalBytes: file.size });
    if (file.name.startsWith("held-")) return new Promise(resolve => heldUploads.push(() => resolve(receipt)));
    return Promise.resolve(receipt);
  },
  deleteAttachment(sessionId, attachmentId) { deleted.push({ sessionId, attachmentId }); return { ok: true }; }
});
const clearAttachments = attachments.clearAttachments;
attachments.clearAttachments = options => {
  acknowledged.push([...options.attachmentIds]);
  return clearAttachments(options);
};
const suggestionsEnabled = ref(false);
const suggestionMode = ref("ready");
const suggestionModel = ref("suggestions-small");
const suggestionRequests = [];
const target = computed(() => conversation.value?.runtime || null);
const modelsEnabled = ref(false);
const modelId = ref("small");
const appliedModel = ref("small");
const modelSaving = ref(false);
const modelCatalogError = ref("");
const modelSelections = [];
const modelChangesDisabled = computed(() => target.value?.snapshot.value?.status === "working");
let finishModelApply;
const models = {
  providerRows: computed(() => [{ id: "application", label: "Application choices" }]),
  modelProviderId: ref("application"),
  modelRows: computed(() => [{ id: "small", label: "Small model" }, { id: "large", label: "Large model" }]),
  modelId, selectionSummary: computed(() => `Selected ${appliedModel.value}`),
  changesDisabled: modelChangesDisabled,
  canSave: computed(() => !modelChangesDisabled.value && !modelCatalogError.value && modelId.value !== appliedModel.value), saving: modelSaving,
  catalogLoading: ref(false), catalogError: modelCatalogError,
  selectModel(value) { modelId.value = value; },
  async apply() {
    const selected = modelId.value;
    modelSelections.push(selected);
    modelSaving.value = true;
    await new Promise(resolve => { finishModelApply = resolve; });
    appliedModel.value = selected;
    modelSaving.value = false;
  },
  reload() { modelCatalogError.value = ""; }
};
const questions = ref(false);
const suggestions = useAssistantSuggestions({
  active: () => Boolean(suggestionsEnabled.value && visible.value && target.value?.available.value &&
    target.value.snapshot.value?.status === "ready"),
  requestKey: () => target.value?.identity || null,
  draft: () => target.value?.draft.value || "",
  configuration: () => ({ integrationId: "suggestions", model: suggestionModel.value }),
  debounceMs: 0,
  generate(input) {
    const request = { ...input, target: { ...target.value.identity } };
    suggestionRequests.push(request);
    if (suggestionMode.value === "hold") return new Promise(resolve => { request.resolve = resolve; });
    return [{ label: "Suggested next step", prompt: `Suggested by ${input.configuration.model}` }];
  },
  onSelect(prompt) {
    if (!target.value?.available.value) return false;
    target.value.draft.value = prompt;
    return true;
  }
});
let retained;
onMounted(() => {
  window.conversationFixture = {
    socket,
    acquireConversation,
    releaseFactory() { factoryScope.stop(); },
    target(id) { conversationId.value = id; },
    show(value) { visible.value = value; },
    multiple(value) { multiple.value = value; },
    mirror(value) { mirror.value = value; },
    async eventReaders(value) { eventReaders.value = value; await nextTick(); },
    readerEvents() { return [...readerEvents]; },
    actor(id) { placement.setContext({ user: id ? { id } : null }); attachmentActor.value = id; },
    current() { return conversation.value?.runtime; },
    presentation(value) { presentation.value = value; },
    adapter() { return conversation.value?.adapter; },
    submit() { return conversation.value.submit(); },
    dispatches() { return [...dispatches]; },
    retainVoice() { retained?.release(); retained = conversation.value.runtime.retain(); voice.value = retained.runtime; },
    releaseVoice() { retained?.release(); retained = null; voice.value = null; },
    sendVoice(text, data) { return voice.value.send({ message: text, ...(data !== undefined ? { data } : {}) }); },
    data(value) { authoredData.value = value; },
    changeFocus(value) { authoredData.value.focus = value; },
    attachments(enabled) { attachmentsEnabled.value = enabled; },
    finishUploads() { for (const resolve of heldUploads.splice(0)) resolve(); },
    suggestions(enabled, mode = "ready") { suggestionMode.value = mode; suggestionsEnabled.value = enabled; },
    questions(options) { questions.value = options; },
    models(enabled) { modelsEnabled.value = enabled; },
    modelError(message) { modelCatalogError.value = message; },
    finishModelApply() { finishModelApply?.(); finishModelApply = null; },
    modelState() { return { selected: modelId.value, applied: appliedModel.value, saving: modelSaving.value, selections: [...modelSelections] }; },
    suggestionModel(value) { suggestionModel.value = value; },
    resolveSuggestion(index, prompt) { suggestionRequests[index]?.resolve?.([{ label: "Suggested next step", prompt }]); },
    suggestionState() { return { items: suggestions.items.value, preview: suggestions.preview.value,
      requests: suggestionRequests.map(({ target, draft, configuration, signal }) => ({ target, draft, configuration, aborted: signal.aborted })) }; },
    attachmentState() { return { ready: attachments.attachments.value.map(file => ({ ...file })),
      queue: attachments.queueItems.value.map(row => ({ fileName: row.fileName, phase: row.phase })),
      uploads, deleted, acknowledged }; },
    voiceState() { return voice.value && { current: voice.value.current.value, available: voice.value.available.value,
      id: voice.value.identity.conversationId, draft: voice.value.draft.value, turns: voice.value.delivery.turns(voice.value.turns.value) }; }
  };
});
onScopeDispose(() => retained?.release());
</script>

<template>
  <v-app>
    <main class="fixture">
      <EventReader v-for="eventReader in eventReaders" :key="eventReader.id" :reader="eventReader" />
      <div v-if="visible" class="fixture__conversation" data-primary>
        <DraftConversation v-if="acceptedDraft" ref="conversation" :conversation-id="conversationId" :data="authoredData" :attachments="attachmentsEnabled ? attachments : null" :presentation="presentation" :on-dispatch="recordDispatch" :draft-while-loading="draftWhileLoading" />
        <AssistantConversationClientElement v-else ref="conversation" :conversation-id="conversationId" :data="authoredData" :attachments="attachmentsEnabled ? attachments : null" :suggestions="suggestionsEnabled ? suggestions : null" :models="modelsEnabled ? models : null" :questions="questions" assistant-label="Primary conversation" />
      </div>
      <div v-if="mirror" class="fixture__conversation" data-mirror>
        <DraftConversation v-if="acceptedDraft" :conversation-id="conversationId" :data="authoredData" :attachments="attachmentsEnabled ? attachments : null" :presentation="presentation" :on-dispatch="recordDispatch" :draft-while-loading="draftWhileLoading" />
        <AssistantConversationClientElement v-else :conversation-id="conversationId" :data="authoredData" :attachments="attachmentsEnabled ? attachments : null" :suggestions="suggestionsEnabled ? suggestions : null" :models="modelsEnabled ? models : null" :questions="questions" assistant-label="Mirror conversation" />
      </div>
      <div v-for="index in (multiple ? [2, 3, 4, 5] : [])" :key="index" class="fixture__conversation" :data-chat="index">
        <AssistantConversationClientElement :conversation-id="`chat:${index}`" :assistant-label="`Conversation ${index}`" />
      </div>
      <output v-if="voice" data-voice>{{ voice.identity.conversationId }} {{ voice.current.value ? 'current' : 'retired' }}</output>
    </main>
  </v-app>
</template>

<style>
html, body, #app { margin: 0; height: 100%; }
.fixture { display: grid; gap: 1rem; padding: 1rem; max-width: 72rem; width: 100%; margin: 0 auto; }
.fixture__conversation { height: min(720px, calc(100dvh - 3rem)); min-height: 360px; min-width: 0; }
</style>
