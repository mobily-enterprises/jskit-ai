// Material 3 window size classes by window width in dp: compact below 600, medium below 840, expanded below 1200 and
// large from 1200 (extra-large folds into large).
const MEDIUM_MIN_WIDTH = 600;
const EXPANDED_MIN_WIDTH = 840;
const LARGE_MIN_WIDTH = 1200;
const WINDOW_SIZE_CLASSES = Object.freeze(["compact", "medium", "expanded", "large"]);

/** @param {number} width */
function resolveWindowSizeClass(width) {
  const value = Number(width) || 0;
  if (value < MEDIUM_MIN_WIDTH) {
    return "compact";
  }
  if (value < EXPANDED_MIN_WIDTH) {
    return "medium";
  }
  if (value < LARGE_MIN_WIDTH) {
    return "expanded";
  }
  return "large";
}

export {
  EXPANDED_MIN_WIDTH,
  LARGE_MIN_WIDTH,
  MEDIUM_MIN_WIDTH,
  WINDOW_SIZE_CLASSES,
  resolveWindowSizeClass
};
