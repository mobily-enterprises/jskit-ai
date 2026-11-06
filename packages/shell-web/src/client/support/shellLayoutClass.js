import { pageViewportWidth } from "../browser.js";
import { resolveWindowSizeClass } from "./windowSizeClass.js";

// The layout class placement variants are keyed by (compact, medium, expanded): the window size class, with large
// placed like expanded.
function resolveShellLayoutClass(viewportWidth = pageViewportWidth()) {
  const sizeClass = resolveWindowSizeClass(viewportWidth);
  return sizeClass === "large" ? "expanded" : sizeClass;
}

export { resolveShellLayoutClass };
