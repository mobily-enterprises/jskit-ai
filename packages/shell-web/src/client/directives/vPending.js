// `v-pending="running"`: a command button that keeps keyboard focus while its action runs. A focused button that
// becomes `disabled` loses focus (Chromium moves it to the page body), so a keyboard or screen-reader user who pressed
// Save, Send or "Load more" lands back at the top of the page. While `running` is true the button stays enabled and
// focusable instead: it reads as unavailable (`aria-disabled="true"`) and ignores activation, so a second click, Enter
// or Space, or a form's implicit submission through it, does nothing until the action settles. When it settles with
// focus still on the button, focus moves to the first field the action's refusal marked (a Vuetify field showing an
// error, or a control with `aria-invalid="true"`): in the button's form, else its dialog, else the page. Without one,
// focus stays on the button.
//
// Put it on the button (`v-btn`, `button`), or on a component that wraps one (`v-fab`, or a live action's `v-checkbox`
// or `v-switch`): the control is the element itself when it is a button, a link, a checkbox or a radio, or else the
// first one inside it. Use it in place of `:disabled` for the pending state; `disabled` stays for an action that cannot
// run at all. Give the button a pending label ("Saving…").

const CONTROL =
  "button, a[href], input[type='submit'], input[type='button'], input[type='checkbox'], input[type='radio'], [role='button']";
const MARKED_FIELD = ".v-input--error, [aria-invalid='true']";
const FOCUSABLE = "input:not([type='hidden']), textarea, select, button, [tabindex]:not([tabindex='-1'])";
const DIALOG = ".v-overlay__content, [role='dialog'], [role='alertdialog'], dialog";
const STATE = Symbol("jskit.shell-web.pending");

/** @param {Element} element */
function controlOf(element) {
  return element.matches(CONTROL) ? element : element.querySelector(CONTROL) || element;
}

/**
 * Capturing on the button (or its wrapper), so its own click handlers, a router link's navigation and a submit
 * button's form submission never see the activation.
 * @param {Event} event
 */
function ignoreWhilePending(event) {
  if (event.currentTarget[STATE]?.pending) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

/** @param {Element} control */
function firstMarkedField(control) {
  const scope = control.form || control.closest(DIALOG) || control.ownerDocument;
  for (const marked of scope.querySelectorAll(MARKED_FIELD)) {
    const field = marked.matches(FOCUSABLE) ? marked : marked.querySelector(FOCUSABLE);
    if (field && !field.disabled && field.getClientRects().length > 0) {
      return field;
    }
  }
  return null;
}

/**
 * @param {Element} element
 * @param {boolean} pending
 */
function mark(element, pending) {
  const state = element[STATE];
  const control = controlOf(element);
  state.pending = pending;
  if (pending) {
    control.setAttribute("aria-disabled", "true");
    state.marked = control;
  } else if (state.marked) {
    state.marked.removeAttribute("aria-disabled");
    state.marked = null;
  }
}

/**
 * The action settled with focus on its button: once the refusal's field errors have drawn, the first marked field
 * takes focus. A later move of focus by the person, or the button going away, leaves focus alone.
 * @param {Element} element
 */
function settle(element) {
  const state = element[STATE];
  clearTimeout(state.settling);
  state.settling = setTimeout(() => {
    state.settling = 0;
    if (state.pending || !element.contains(element.ownerDocument.activeElement)) {
      return;
    }
    firstMarkedField(controlOf(element))?.focus();
  }, 0);
}

/** @type {import("vue").ObjectDirective<HTMLElement, boolean | undefined>} */
const vPending = {
  mounted(element, binding) {
    element[STATE] = { pending: false, marked: null, settling: 0 };
    element.addEventListener("click", ignoreWhilePending, true);
    mark(element, Boolean(binding.value));
  },
  updated(element, binding) {
    const pending = Boolean(binding.value);
    const wasPending = element[STATE].pending;
    mark(element, pending);
    if (wasPending && !pending && element.contains(element.ownerDocument.activeElement)) {
      settle(element);
    }
  },
  beforeUnmount(element) {
    clearTimeout(element[STATE]?.settling);
    element.removeEventListener("click", ignoreWhilePending, true);
    delete element[STATE];
  }
};

export { vPending };
