import { shallowReactive } from "vue";

// A typed filter value (a record id, a number range's bound) reaches the list once the person pauses, presses Enter or
// leaves the field, not with every key: typing "1500" asks for one list, not four. Clearing applies at once.
const FILTER_TYPING_DELAY_MS = 400;

/**
 * Typing over a filter value that `read(key)` answers and `write(key, value)` sets. The field shows `value(key)`, the
 * typed text while it waits, and sends each change to `type(key, value)`; `apply(key)` sends it on Enter or blur.
 * @param {{ read: (key: string) => unknown, write: (key: string, value: unknown) => void, delayMs?: number }} options
 */
function createFilterTyping({ read, write, delayMs = FILTER_TYPING_DELAY_MS }) {
  const drafts = shallowReactive(new Map());
  const timers = new Map();

  function value(key) {
    return drafts.has(key) ? drafts.get(key) : read(key);
  }

  function apply(key) {
    clearTimeout(timers.get(key));
    timers.delete(key);
    if (!drafts.has(key)) {
      return;
    }
    const typed = drafts.get(key);
    drafts.delete(key);
    write(key, typed);
  }

  function type(key, typed) {
    drafts.set(key, typed);
    clearTimeout(timers.get(key));
    if (typed === null || typed === undefined || typed === "") {
      apply(key);
      return;
    }
    timers.set(key, setTimeout(() => apply(key), delayMs));
  }

  function applyAll() {
    for (const key of [...drafts.keys()]) {
      apply(key);
    }
  }

  return Object.freeze({
    value,
    type,
    apply,
    applyAll
  });
}

export { FILTER_TYPING_DELAY_MS, createFilterTyping };
