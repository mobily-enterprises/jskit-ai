// Vuetify's ripple directive adds its key listeners when it mounts, after a control's own, so it hears a key after the
// control's own handler. When that handler moves focus (Enter on a card that opens a panel and focuses its title), the
// control's blur, which ends a keyboard ripple, comes before the ripple exists; the directive then shows the ripple on a
// control that no longer holds focus, the key comes up on the new focus, and nothing ends the ripple. It stays drawn
// (and axe reads its whole box, which reaches past the control, as covering the text around it), and Vuetify's flag
// that one keyboard ripple is showing stays set, so the next control pressed shows none until some rippling control
// blurs. When a key comes up, each control around where it went down that shows a ripple but no longer holds focus is
// sent the blur it missed: Vuetify's own blur listener ends the ripple and clears the flag. (A blur listener of the
// control's own hears it a second time; the control has not held focus since the first.)
const INSTALLED = Symbol.for("@jskit-ai/material-web/keyboard-ripples");
// A ripple Vuetify shows (--visible from the start) and has not begun to hide, in a control's own ripple container.
const LIVE_RIPPLE = ":scope > .v-ripple__container > .v-ripple__animation--visible:not([data-is-hiding])";

/**
 * Ends a keyboard press's ripple when the press ends, on a control whose own key handler moved focus away before
 * Vuetify's ripple heard the key. Listens on `view` once, however often it is called, for as long as the page lives or
 * until the returned function releases it; does nothing without a document.
 * @param {Window | undefined} view
 * @returns {(() => void) | undefined} releases the listeners
 */
function endKeyboardRipplesWithThePress(view) {
  if (!view?.document) return undefined;
  if (view[INSTALLED]) return view[INSTALLED];
  // Where each key held down went down. Captured on the window, so a handler that stops the key does not hide it.
  const pressed = new Map();
  function notePress(event) {
    if (!event.repeat) pressed.set(event.key, event.target);
  }
  function endRipplesLeftBehind(event) {
    const origin = pressed.get(event.key);
    pressed.delete(event.key);
    const focused = view.document.activeElement;
    for (let control = origin instanceof view.Element ? origin : null; control; control = control.parentElement) {
      if (!control.contains(focused) && control.querySelector(LIVE_RIPPLE)) control.dispatchEvent(new view.FocusEvent("blur"));
    }
  }
  view.addEventListener("keydown", notePress, true);
  view.addEventListener("keyup", endRipplesLeftBehind, true);
  view[INSTALLED] = function release() {
    view.removeEventListener("keydown", notePress, true);
    view.removeEventListener("keyup", endRipplesLeftBehind, true);
    delete view[INSTALLED];
  };
  return view[INSTALLED];
}

export { endKeyboardRipplesWithThePress };
