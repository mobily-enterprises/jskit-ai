const EMPTY_PRESENTATION_STATE = Object.freeze({
  revision: 0,
  channels: Object.freeze({
    snackbar: Object.freeze([]),
    banner: Object.freeze([]),
    dialog: Object.freeze([])
  })
});

const EMPTY_PRESENTATION_STORE = Object.freeze({
  getState() {
    return EMPTY_PRESENTATION_STATE;
  },
  subscribe() {
    return () => {};
  },
  present() {
    throw new Error("Shell web error presentation store is not available.");
  },
  dismiss() {
    return 0;
  },
  clear() {
    return 0;
  }
});

export {
  EMPTY_PRESENTATION_STATE,
  EMPTY_PRESENTATION_STORE
};
