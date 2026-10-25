const SHELL_GESTURE_IGNORED_SELECTORS = Object.freeze([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='slider']",
  "[contenteditable='true']",
  "[data-shell-swipe-ignore]"
]);

// Shell gestures follow touch and pen contact, never a mouse drag.
function isPrimaryTouchPointer(event) {
  return event?.isPrimary !== false && event?.button === 0 && event?.pointerType !== "mouse";
}

// Interactive controls keep their own gestures; the shell does not start one on them.
function isShellGestureIgnoredTarget(target, { extraSelectors = [] } = {}) {
  const selectors = [...SHELL_GESTURE_IGNORED_SELECTORS, ...extraSelectors].join(",");
  return Boolean(target?.closest?.(selectors));
}

export { isPrimaryTouchPointer, isShellGestureIgnoredTarget };
