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

export { subscribeListener };
