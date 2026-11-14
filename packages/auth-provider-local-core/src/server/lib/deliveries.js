/**
 * How long a stopping server waits for the emails local auth is still sending, before it stops anyway.
 */
const DELIVERY_SHUTDOWN_WAIT_MS = 10_000;

/**
 * The emails local auth sends after answering the request that asked for them. Asking for a password reset, or for a
 * new confirmation link, answers the same whether or not the email has an account or a waiting registration, so the
 * answer must not wait on work done only when it has one: looking it up and writing a new link differ in time, and
 * the sender's own time and failures differ most. That work runs here instead, once the request has answered. Each
 * piece starts at once; its failure is logged, never the link it carries, and is not the requester's to see. A
 * stopping server waits for the emails still being sent (settled).
 * @param {object} dependencies
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 */
function createLocalDeliveries({ logger }) {
  const sending = new Set();

  /**
   * Starts sending one email, after the request that asked for it has answered.
   * @param {string} what The email, for the log: "the password reset email".
   * @param {string} email The address it goes to, for the log.
   * @param {() => Promise<void>} work Finds what the email needs, and sends it when there is something to send.
   */
  function send(what, email, work) {
    const delivery = Promise.resolve()
      .then(work)
      .catch((error) => {
        logger.error({ err: error, email }, `Sending ${what} failed.`);
      })
      .finally(() => {
        sending.delete(delivery);
      });
    sending.add(delivery);
  }

  /**
   * Waits for the emails being sent, those they start included, for at most `timeoutMs` when it is given; true when
   * every one finished, false when some were still being sent, which is logged.
   * @param {{ timeoutMs?: number }} [options]
   */
  async function settled({ timeoutMs } = {}) {
    let timer = null;
    const timedOut = timeoutMs === undefined
      ? null
      : new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs, false);
      });
    try {
      while (sending.size > 0) {
        const finished = Promise.all(sending).then(() => true);
        if (!(await (timedOut ? Promise.race([finished, timedOut]) : finished))) {
          logger.warn(
            { unfinishedEmails: sending.size },
            "Local auth stopped waiting for the emails it was still sending; they may not arrive."
          );
          return false;
        }
      }
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    send,
    settled
  });
}

export { DELIVERY_SHUTDOWN_WAIT_MS, createLocalDeliveries };
