import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import SyncStatusElement from "/src/components/SyncStatusElement.vue";

const MainClientProvider = defineProvider({
  id: "local.main.client",
  requires: {
    components: "client.components"
  },
  setup({ components }) {
    components.register("local.main.ui.sync-status", SyncStatusElement);
  }
});

export { MainClientProvider };
