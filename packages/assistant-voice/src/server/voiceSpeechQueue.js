/**
 * Runs up to `concurrency` operations at once and holds at most `maximumQueued`
 * more; past that it refuses with voice_busy.
 */
function createBoundedSpeechQueue({ concurrency = 1, maximumQueued = 4 } = {}) {
  const pending = [];
  let running = 0;
  let closed = false;

  // An operation leaves the count before its caller hears its result, so a
  // caller that reads depth afterwards does not count it.
  const settle = (callback, value) => {
    running -= 1;
    callback(value);
    drain();
  };
  const drain = () => {
    while (!closed && running < concurrency && pending.length) {
      const next = pending.shift();
      running += 1;
      Promise.resolve()
        .then(next.operation)
        .then(value => settle(next.resolve, value), error => settle(next.reject, error));
    }
  };

  function close() {
    closed = true;
    const error = Object.assign(new Error("Voice speech queue is shutting down."), {
      code: "voice_queue_closed", messageCode: "assistant.voice.daemon.queueClosing", messageParams: {}
    });
    for (const entry of pending.splice(0)) {
      entry.reject(error);
    }
  }

  function run(operation) {
    if (closed) {
      const error = Object.assign(new Error("Voice speech queue is unavailable."), {
        code: "voice_queue_closed", messageCode: "assistant.voice.daemon.queueUnavailable", messageParams: {}
      });
      return Promise.reject(error);
    }
    if (typeof operation !== "function") {
      return Promise.reject(new TypeError("Voice speech queue requires an operation."));
    }
    if (pending.length >= maximumQueued) {
      const error = Object.assign(new Error("Voice speech capacity is currently busy. Try again shortly."), {
        code: "voice_busy", messageCode: "assistant.voice.daemon.capacityBusy", messageParams: {}
      });
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      pending.push({ operation, reject, resolve });
      drain();
    });
  }

  return Object.freeze({
    close,
    get depth() {
      return pending.length + running;
    },
    run
  });
}

export { createBoundedSpeechQueue };
