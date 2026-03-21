function subscribeListener(listeners, listener) {
  if (!(listeners instanceof Set)) {
    throw new TypeError("subscribeListener requires a Set.");
  }

  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function createListenerSubscription(listeners) {
  if (!(listeners instanceof Set)) {
    throw new TypeError("createListenerSubscription requires a Set.");
  }

  return function subscribe(listener) {
    return subscribeListener(listeners, listener);
  };
}

export { subscribeListener, createListenerSubscription };
