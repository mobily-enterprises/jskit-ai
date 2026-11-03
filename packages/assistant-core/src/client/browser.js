// The browser's timers and animation frames, for client code that also runs where there is no window (server
// rendering and node tests). Without one, timers and frames are not scheduled and each caller takes its own path.

/** Whether the page has a window whose `name` (a timer, frame or media function) can be called. */
function hasWindowFunction(name) {
  // readable-check: allow method-probe - platform object: window exists only in a browser
  return typeof window !== "undefined" && typeof window[name] === "function";
}

/** Resolves after the next animation frame, or at once without a window. */
function waitForLayoutFrame() {
  if (!hasWindowFunction("requestAnimationFrame")) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(resolve);
  });
}

export { hasWindowFunction, waitForLayoutFrame };
