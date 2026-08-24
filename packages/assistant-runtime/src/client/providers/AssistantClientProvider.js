import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import AssistantSettingsClientElement from "../components/AssistantSettingsClientElement.vue";

const AssistantClientProvider = defineProvider({
  id: "assistant.web.client",
  requires: {
    components: "client.components"
  },
  setup({ components }) {
    components.register("assistant.web.settings.element", AssistantSettingsClientElement);
  }
});

export { AssistantClientProvider };
