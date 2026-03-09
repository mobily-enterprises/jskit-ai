import { useAccountCommand } from "./useAccountCommand.js";

function useGlobalCommand(options = {}) {
  const source = options && typeof options === "object" ? options : {};

  return useAccountCommand({
    placementSource: "users-web.global.command",
    ...source
  });
}

export { useGlobalCommand };
