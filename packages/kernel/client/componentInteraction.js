import {
  normalizeObject,
  normalizeText
} from "../shared/support/normalize.js";

function createComponentInteractionEmitter(emit) {
  if (typeof emit !== "function") {
    throw new TypeError("createComponentInteractionEmitter expects emit to be a function.");
  }

  function emitInteraction(type, payload = {}) {
    emit("interaction", {
      type: normalizeText(type),
      ...normalizeObject(payload)
    });
  }

  async function invokeAction(actionName, payload, callback) {
    emit("action:started", {
      action: normalizeText(actionName),
      payload
    });

    try {
      if (typeof callback === "function") {
        await callback();
      }

      emit("action:succeeded", {
        action: normalizeText(actionName),
        payload
      });
    } catch (errorValue) {
      emit("action:failed", {
        action: normalizeText(actionName),
        payload,
        message: String(errorValue?.message || "Action failed")
      });
      throw errorValue;
    }
  }

  return Object.freeze({
    emitInteraction,
    invokeAction
  });
}

export {
  createComponentInteractionEmitter
};
