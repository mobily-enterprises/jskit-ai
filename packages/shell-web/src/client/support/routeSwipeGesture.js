const SWIPE_MIN_DISTANCE = 36;
const SWIPE_MAX_VERTICAL_DRIFT = 120;
const SWIPE_MIN_VELOCITY = 0.08;
const SWIPE_CLAIM_DISTANCE = 10;
const NO_SWIPE = Object.freeze({ claim: false, offset: 0 });

function isAcceptedSwipe({ deltaX = 0, deltaY = 0, elapsed = 1 } = {}) {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  const velocity = absX / Math.max(elapsed, 1);
  return absX >= SWIPE_MIN_DISTANCE && absY <= SWIPE_MAX_VERTICAL_DRIFT && absX > absY && velocity >= SWIPE_MIN_VELOCITY;
}

function isVerticalDrift(absX, absY) {
  return absY > SWIPE_MAX_VERTICAL_DRIFT || (absY > 28 && absY > absX * 1.3);
}

// Tracks one horizontal swipe between primary navigation destinations. A swipe
// that drifts vertically is dropped for good: the gesture became a scroll.
function createRouteSwipeGesture({ now = () => performance.now() } = {}) {
  let active = null;

  function tracks(pointerId) {
    return Boolean(active) && pointerId === active.pointerId;
  }

  function start({ pointerId, clientX, clientY }) {
    active = { pointerId, startX: clientX, startY: clientY, startTime: now() };
  }

  function reset() {
    active = null;
  }

  function measure({ clientX, clientY }) {
    return {
      deltaX: clientX - active.startX,
      deltaY: clientY - active.startY,
      elapsed: Math.max(now() - active.startTime, 1)
    };
  }

  function offsetFor(deltaX) {
    return deltaX < 0 ? 1 : -1;
  }

  function move(event) {
    if (!tracks(event.pointerId)) {
      return NO_SWIPE;
    }

    const swipe = measure(event);
    const absX = Math.abs(swipe.deltaX);
    const absY = Math.abs(swipe.deltaY);
    if (isVerticalDrift(absX, absY)) {
      active = null;
      return NO_SWIPE;
    }

    const claim = absX > SWIPE_CLAIM_DISTANCE && absX > absY;
    if (!isAcceptedSwipe(swipe)) {
      return { claim, offset: 0 };
    }

    active = null;
    return { claim, offset: offsetFor(swipe.deltaX) };
  }

  function end(event) {
    if (!tracks(event.pointerId)) {
      return 0;
    }

    const swipe = measure(event);
    active = null;
    return isAcceptedSwipe(swipe) ? offsetFor(swipe.deltaX) : 0;
  }

  function cancel(event) {
    if (tracks(event.pointerId)) {
      active = null;
    }
  }

  return Object.freeze({ start, reset, move, end, cancel });
}

export { createRouteSwipeGesture };
