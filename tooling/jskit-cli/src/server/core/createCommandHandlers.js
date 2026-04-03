import { createCommandHandlerShared } from "../commandHandlers/shared.js";
import { createListCommands } from "../commandHandlers/list.js";
import { createShowCommand } from "../commandHandlers/show.js";
import { createPackageCommands } from "../commandHandlers/package.js";
import { createHealthCommands } from "../commandHandlers/health.js";

function createCommandHandlers(deps = {}) {
  const shared = createCommandHandlerShared(deps);
  const commandContext = {
    ...deps,
    ...shared
  };

  const { commandList, commandListPlacements, commandListLinkItems } = createListCommands(commandContext);
  const { commandShow } = createShowCommand(commandContext);
  const {
    commandCreate,
    commandAdd,
    commandGenerate,
    commandUpdate,
    commandMigrations,
    commandPosition,
    commandRemove
  } = createPackageCommands(commandContext);
  const { commandDoctor, commandLintDescriptors } = createHealthCommands(commandContext);

  return {
    commandList,
    commandListPlacements,
    commandListLinkItems,
    commandShow,
    commandCreate,
    commandAdd,
    commandGenerate,
    commandMigrations,
    commandPosition,
    commandUpdate,
    commandRemove,
    commandDoctor,
    commandLintDescriptors
  };
}

export { createCommandHandlers };
