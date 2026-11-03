import { onBeforeUnmount, onMounted, watch } from "vue";

/**
 * Grows the prompt's textarea with its text, up to its CSS max-height, after each change of its model value,
 * placeholder, rows or density and each change of its width. preserveHeightForNextModelValue() keeps the current
 * height through the next model value change; typing ends that hold.
 * @param {{
 *   autoGrow: boolean,
 *   density: string,
 *   modelValue: string,
 *   placeholder: string,
 *   placeholderAffectsHeight: boolean,
 *   rows: number | string
 * }} props The prompt input's props.
 * @param {import("vue").Ref<HTMLTextAreaElement | null>} textareaRef
 */
function useTextareaAutoGrow(props, textareaRef) {
  let resizeFrame = 0;
  let resizeObserver = null;
  let preserveHeightForNextModelValueChange = false;

  function resizeTextarea() {
    if (!props.autoGrow) {
      return;
    }
    const textarea = textareaRef.value;
    if (!textarea) {
      return;
    }
    if (!props.placeholderAffectsHeight && !textarea.value) {
      return;
    }
    const style = window.getComputedStyle(textarea);
    const minHeight = Number.parseFloat(style.minHeight) || 0;
    const maxHeight = Number.parseFloat(style.maxHeight) || Number.POSITIVE_INFINITY;
    textarea.style.height = "auto";
    const contentHeight = Math.max(textarea.scrollHeight, minHeight);
    const targetHeight = Math.min(contentHeight, maxHeight);
    textarea.style.height = `${targetHeight}px`;
    textarea.style.overflowY = contentHeight > targetHeight + 1 ? "auto" : "hidden";
  }

  function queueResizeTextarea() {
    if (!props.autoGrow || typeof window === "undefined") {
      return;
    }
    if (resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      resizeTextarea();
    });
  }

  function preserveHeightForNextModelValue() {
    const textarea = textareaRef.value;
    if (!props.autoGrow || !textarea) {
      return false;
    }
    if (resizeFrame) {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
    }
    preserveHeightForNextModelValueChange = true;
    textarea.style.height = `${textarea.getBoundingClientRect().height}px`;
    textarea.style.overflowY = "auto";
    return true;
  }

  /** Typing writes the model value itself, so its next change resizes the textarea again. */
  function releasePreservedHeight() {
    preserveHeightForNextModelValueChange = false;
  }

  onMounted(() => {
    queueResizeTextarea();
    let lastWidth = 0;
    resizeObserver = new ResizeObserver(([entry]) => {
      // Height changes are our own output. Only width changes need another layout.
      const width = entry.contentRect.width;
      if (width !== lastWidth) {
        lastWidth = width;
        queueResizeTextarea();
      }
    });
    resizeObserver.observe(textareaRef.value);
  });

  onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    if (resizeFrame && typeof window !== "undefined") {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
    }
  });

  watch(() => [
    props.autoGrow,
    props.modelValue,
    props.placeholder,
    props.placeholderAffectsHeight,
    props.rows,
    props.density
  ], (values, previousValues = []) => {
    const modelValueChanged = values[1] !== previousValues[1];
    if (preserveHeightForNextModelValueChange && modelValueChanged) {
      preserveHeightForNextModelValueChange = false;
      return;
    }
    queueResizeTextarea();
  }, { flush: "post" });

  return { preserveHeightForNextModelValue, queueResizeTextarea, releasePreservedHeight };
}

export { useTextareaAutoGrow };
