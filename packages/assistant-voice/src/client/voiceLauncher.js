import { onScopeDispose, ref, toValue } from "vue";

/** Optional hold gesture for a launcher; the shared host still owns capture. */
export function useVoiceLauncher({ open, enabled = true, onTap = null, onError = () => {} }) {
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
    begin(event.key, onTap ? 350 : 0);
  }
  function finish(discard) {
    clearTimeout(timer);
    const keyboard = typeof input === "string";
    input = null;
    ++revision;
    if (!holding.value) {
      if (!discard && keyboard && onTap) report(onTap());
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
    if (toValue(enabled) && onTap) report(onTap());
  }
  onScopeDispose(cancel);
  return { holding, pointerDown, pointerUp, keyDown, keyUp, cancel, click };
}
