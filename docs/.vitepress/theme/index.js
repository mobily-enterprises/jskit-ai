import DefaultTheme from "vitepress/theme";
import DocsTerminalTip from "./components/DocsTerminalTip.vue";
import "./custom.css";

export default {
  ...DefaultTheme,
  enhanceApp(context) {
    DefaultTheme.enhanceApp?.(context);
    context.app.component("DocsTerminalTip", DocsTerminalTip);
  }
};
