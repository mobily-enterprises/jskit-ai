/**
 * Waits until `work` settles or `ms` pass, whichever comes first, and leaves no timer behind: one
 * left running kept a closed server's process alive for the whole wait (20 seconds for a drain on
 * shutdown, 2 minutes after a command that ended in its foreground wait). Resolves with the work's
 * value, or undefined when the time ran out; rejects when the work does. `work` may be a plain value
 * (no loop running), which counts as settled at once.
 * @template T
 * @param {Promise<T> | T} work
 * @param {number} ms
 * @returns {Promise<T | undefined>}
 */
export async function settledWithin(work, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
