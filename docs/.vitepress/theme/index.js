import DefaultTheme from "vitepress/theme";
import DocsInDepth from "./components/DocsInDepth.vue";
import DocsTerminalTip from "./components/DocsTerminalTip.vue";
import "./custom.css";

export default {
  ...DefaultTheme,
  enhanceApp(context) {
    DefaultTheme.enhanceApp?.(context);
    context.app.component("DocsInDepth", DocsInDepth);
    context.app.component("DocsTerminalTip", DocsTerminalTip);
  }
};
