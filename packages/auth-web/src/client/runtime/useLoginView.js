import { useDefaultLoginView } from "../composables/useDefaultLoginView.js";

function useLoginView() {
  return useDefaultLoginView();
}

export { useLoginView, useDefaultLoginView };
