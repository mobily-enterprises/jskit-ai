import { useAccountView } from "./useAccountView.js";

function useGlobalView(options = {}) {
  const source = options && typeof options === "object" ? options : {};

  return useAccountView({
    placementSource: "users-web.global.view",
    ...source
  });
}

export { useGlobalView };
