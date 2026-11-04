import { normalizeText } from "./normalize.js";

/**
 * @param {object} options
 * @param {string} options.id
 * @param {string} options.channel
 * @param {import("../types.js").ShellErrorPresentationStore} options.store
 */
function createStoreBackedPresenter({
  id,
  channel,
  store
}) {
  const normalizedId = normalizeText(id);
  const normalizedChannel = normalizeText(channel).toLowerCase();
  if (!normalizedId) {
    throw new Error("createStoreBackedPresenter requires id.");
  }
  if (!normalizedChannel) {
    throw new Error(`createStoreBackedPresenter("${normalizedId}") requires channel.`);
  }

  function supports(requestedChannel = "") {
    return String(requestedChannel || "").trim().toLowerCase() === normalizedChannel;
  }

  function present(payload = {}) {
    return store.present(normalizedChannel, {
      ...payload,
      presenterId: normalizedId
    });
  }

  function dismiss(presentationId = "") {
    return store.dismiss(normalizedChannel, String(presentationId || ""));
  }

  return Object.freeze({
    id: normalizedId,
    supports,
    present,
    dismiss
  });
}

/**
 * @param {object} options
 * @param {import("../types.js").ShellErrorPresentationStore} options.store
 */
function createMaterialSnackbarPresenter({ store }) {
  return createStoreBackedPresenter({
    id: "material.snackbar",
    channel: "snackbar",
    store
  });
}

/**
 * @param {object} options
 * @param {import("../types.js").ShellErrorPresentationStore} options.store
 */
function createMaterialBannerPresenter({ store }) {
  return createStoreBackedPresenter({
    id: "material.banner",
    channel: "banner",
    store
  });
}

/**
 * @param {object} options
 * @param {import("../types.js").ShellErrorPresentationStore} options.store
 */
function createMaterialDialogPresenter({ store }) {
  return createStoreBackedPresenter({
    id: "material.dialog",
    channel: "dialog",
    store
  });
}

/**
 * @param {object} options
 * @param {import("../types.js").ShellErrorPresentationStore} options.store
 */
function createDefaultMaterialErrorPresenters({ store }) {
  return Object.freeze([
    createMaterialSnackbarPresenter({ store }),
    createMaterialBannerPresenter({ store }),
    createMaterialDialogPresenter({ store })
  ]);
}

export {
  createStoreBackedPresenter,
  createMaterialSnackbarPresenter,
  createMaterialBannerPresenter,
  createMaterialDialogPresenter,
  createDefaultMaterialErrorPresenters
};
