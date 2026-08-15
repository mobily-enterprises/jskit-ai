import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import MenuLinkItem from "/src/components/menus/MenuLinkItem.vue";
import SurfaceAwareMenuLinkItem from "/src/components/menus/SurfaceAwareMenuLinkItem.vue";
import TabLinkItem from "/src/components/menus/TabLinkItem.vue";

const MainClientProvider = defineProvider({
  id: "local.main.client",
  requires: {
    components: "client.components"
  },
  setup({ components }) {
    components.register("local.main.ui.menu-link-item", MenuLinkItem);
    components.register("local.main.ui.surface-aware-menu-link-item", SurfaceAwareMenuLinkItem);
    components.register("local.main.ui.tab-link-item", TabLinkItem);
  }
});

export { MainClientProvider };
