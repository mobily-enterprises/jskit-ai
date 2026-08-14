import { createCommandHandlerShared } from "../commandHandlers/shared.js";
import { createListCommands } from "../commandHandlers/list.js";
import { createShowCommand } from "../commandHandlers/show.js";
import { createPackageCommands } from "../commandHandlers/package.js";
import { createAppCommands } from "../commandHandlers/app.js";
import { createMobileCommands } from "../commandHandlers/mobile.js";
import { createHealthCommands } from "../commandHandlers/health.js";
import { createCompletionCommands } from "../commandHandlers/completion.js";
import { createBlueprintCommands } from "../commandHandlers/blueprint.js";
import { createSynchronizationCommands } from "../commandHandlers/synchronization.js";

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
    commandRemove
  } = createPackageCommands(commandContext);
  const { commandApp } = createAppCommands(commandContext);
  const { commandMobile } = createMobileCommands(commandContext, { commandAdd });
  const { commandDoctor, commandLintPackages } = createHealthCommands(commandContext);
  const { commandCompletion } = createCompletionCommands(commandContext);
  const { commandBlueprint } = createBlueprintCommands(commandContext);
  const { commandCi, commandMigrations } = createSynchronizationCommands(commandContext);

  return {
    commandList,
    commandListPlacements,
    commandListLinkItems,
    commandCompletion,
    commandShow,
    commandApp,
    commandMobile,
    commandCreate,
    commandAdd,
    commandGenerate,
    commandRemove,
    commandDoctor,
    commandLintPackages,
    commandBlueprint,
    commandCi,
    commandMigrations
  };
}

export { createCommandHandlers };
