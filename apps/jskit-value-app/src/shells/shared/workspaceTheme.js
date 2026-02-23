import { coerceWorkspaceColor as normalizeWorkspaceColor } from "../../../shared/workspace/colors.js";

function workspaceColorToRgb(color) {
  const normalized = normalizeWorkspaceColor(color).replace(/^#/, "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return [red, green, blue];
}

function buildWorkspaceThemeStyle(color) {
  const normalizedColor = normalizeWorkspaceColor(color);
  const [red, green, blue] = workspaceColorToRgb(normalizedColor);
  return {
    "--v-theme-primary": `${red}, ${green}, ${blue}`,
    "--workspace-color": normalizedColor,
    "--workspace-color-soft": `rgba(${red}, ${green}, ${blue}, 0.12)`,
    "--workspace-color-strong": `rgba(${red}, ${green}, ${blue}, 0.24)`
  };
}

export { buildWorkspaceThemeStyle, normalizeWorkspaceColor };
