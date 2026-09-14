function attachSocketConnectionRecovery(socket) {
  let timer = null;
  let delay = 1_000;
  let recovering = false;
  const document = globalThis.document;
  const window = globalThis.window;

  function clearRetry() {
    clearTimeout(timer);
    timer = null;
  }

  function canRetry() {
    return recovering && !socket.connected && !socket.active &&
      socket.io.reconnection() &&
      !document?.hidden && window?.navigator?.onLine !== false;
  }

  function scheduleRetry() {
    if (timer !== null || !canRetry()) return;
    timer = setTimeout(() => {
      timer = null;
      if (canRetry()) socket.connect();
    }, delay);
    delay = Math.min(delay * 2, 30_000);
  }

  function onConnect() {
    clearRetry();
    recovering = false;
    delay = 1_000;
  }

  function onDisconnect(reason) {
    clearRetry();
    // Socket.IO retries transport failures itself, but not a server disconnect.
    recovering = reason === "io server disconnect";
    scheduleRetry();
  }

  function onConnectError() {
    recovering = true;
    scheduleRetry();
  }

  function onAvailable() {
    if (!canRetry()) return;
    clearRetry();
    socket.connect();
  }

  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);
  socket.on("connect_error", onConnectError);
  document?.addEventListener("visibilitychange", onAvailable);
  window?.addEventListener("online", onAvailable);
  return () => {
    recovering = false;
    clearRetry();
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
    socket.off("connect_error", onConnectError);
    document?.removeEventListener("visibilitychange", onAvailable);
    window?.removeEventListener("online", onAvailable);
  };
}

export { attachSocketConnectionRecovery };
