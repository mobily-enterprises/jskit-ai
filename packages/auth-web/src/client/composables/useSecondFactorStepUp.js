import { ref } from "vue";
import { isSecondFactorRequired } from "@jskit-ai/auth-core/shared/authSecondFactor";

/**
 * Runs requests a route may refuse until the session proves its second factor. When one is refused for that, `open`
 * turns true (bind it to `SecondFactorDialog`) and the request waits: after `verified()` it runs once more, and after
 * `cancel()` its refusal is thrown to the caller.
 */
function useSecondFactorStepUp() {
  const open = ref(false);
  /** @type {{ resolve: () => void, reject: () => void }[]} */
  const waiting = [];

  /**
   * @template T
   * @param {() => Promise<T>} request
   * @returns {Promise<T>}
   */
  async function run(request) {
    try {
      return await request();
    } catch (error) {
      if (!isSecondFactorRequired(error)) {
        throw error;
      }
      await new Promise((resolve, reject) => {
        waiting.push({ resolve, reject: () => reject(error) });
        open.value = true;
      });
      return request();
    }
  }

  function verified() {
    open.value = false;
    for (const request of waiting.splice(0)) {
      request.resolve();
    }
  }

  function cancel() {
    open.value = false;
    for (const request of waiting.splice(0)) {
      request.reject();
    }
  }

  return { open, run, verified, cancel };
}

export { useSecondFactorStepUp };
