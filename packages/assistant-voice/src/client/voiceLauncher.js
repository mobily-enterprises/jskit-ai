import { onScopeDispose, ref, toValue } from "vue";

/** Reports nothing when an application leaves out onError. */
function ignoreLauncherError() {}

/**
 * Optional hold gesture for a launcher; the shared host still owns capture.
 * @param {{
 *   open: () => import("./types.js").VoiceHeldRecording | false | null | Promise<import("./types.js").VoiceHeldRecording | false | null>,
 *   enabled?: import("vue").MaybeRefOrGetter<boolean>,
 *   onTap?: (() => unknown) | null,
 *   onError?: (error: unknown) => void
 * }} options
 */
export function useVoiceLauncher({ open, enabled = true, onTap, onError = ignoreLauncherError }) {
  // readable-check: allow method-probe - optional operation: a launcher without onTap has no tap action, so a key press starts its hold at once
  const tappable = typeof onTap === "function";
  const holding = ref(false);
  let input = null;
  let timer;
  let suppressClick = false;
  let revision = 0;
  let session;
  function report(operation) { Promise.resolve(operation).catch(onError); }
  function begin(identity, delay) {
    suppressClick = false;
    input = identity;
    const expected = ++revision;
    timer = setTimeout(() => {
      holding.value = true;
      report((async () => {
        const opened = await open();
        if (expected !== revision || !holding.value || !opened) return;
        session = opened;
        await session.startHeldRecording();
      })());
    }, delay);
  }
  function pointerDown(event) {
    if (!toValue(enabled) || event.button !== 0 || event.isPrimary === false || input !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    begin(event.pointerId, 350);
  }
  function keyDown(event) {
    if (!toValue(enabled) || event.repeat || input !== null || ![" ", "Enter"].includes(event.key)) return;
    begin(event.key, tappable ? 350 : 0);
  }
  function finish(discard) {
    clearTimeout(timer);
    const keyboard = typeof input === "string";
    input = null;
    ++revision;
    if (!holding.value) {
      if (!discard && keyboard && tappable) report(onTap());
      return;
    }
    holding.value = false;
    suppressClick = true;
    if (session) report(discard ? session.discardHeldRecording() : session.finishHeldRecording());
    session = null;
  }
  function pointerUp(event) { if (event.pointerId === input) finish(false); }
  function keyUp(event) { if (event.key === input) finish(false); }
  function cancel(event) {
    if (event?.pointerId !== undefined && event.pointerId !== input) return;
    finish(true);
  }
  function click(event) {
    const suppressed = suppressClick && event.detail !== 0;
    suppressClick = false;
    if (suppressed) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (toValue(enabled) && tappable) report(onTap());
  }
  onScopeDispose(cancel);
  return { holding, pointerDown, pointerUp, keyDown, keyUp, cancel, click };
}
