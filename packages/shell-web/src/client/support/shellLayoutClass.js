const COMPACT_MAX_WIDTH = 600;
const MEDIUM_MAX_WIDTH = 1280;

// Maps the Vuetify display breakpoint name to the shell layout class. Without
// a known breakpoint the viewport width decides.
function resolveShellLayoutClass(displayName = "", viewportWidth = 0) {
  const name = String(displayName || "").trim().toLowerCase();
  if (name === "xs" || name === "sm") {
    return "compact";
  }
  if (name === "md") {
    return "medium";
  }
  if (name === "lg" || name === "xl" || name === "xxl") {
    return "expanded";
  }

  const width = Number(viewportWidth) || 0;
  if (width > 0 && width < COMPACT_MAX_WIDTH) {
    return "compact";
  }
  if (width > 0 && width < MEDIUM_MAX_WIDTH) {
    return "medium";
  }
  return "expanded";
}

function readViewportWidth() {
  return typeof window === "object" ? Number(window.innerWidth || 0) : 0;
}

export { readViewportWidth, resolveShellLayoutClass };
