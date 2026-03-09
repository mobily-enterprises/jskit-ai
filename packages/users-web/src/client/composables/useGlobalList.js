import { useAccountList } from "./useAccountList.js";

function useGlobalList(options = {}) {
  const source = options && typeof options === "object" ? options : {};

  return useAccountList({
    placementSource: "users-web.global.list",
    ...source
  });
}

export { useGlobalList };
