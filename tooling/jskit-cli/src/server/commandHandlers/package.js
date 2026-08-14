import { runPackageCreateCommand } from "./packageCommands/create.js";
import { runPackageAddCommand } from "./packageCommands/add.js";
import { runPackageGenerateCommand } from "./packageCommands/generate.js";
import { runPackageRemoveCommand } from "./packageCommands/remove.js";

function createPackageCommands(ctx = {}) {
  const commandAdd = async (args) => runPackageAddCommand(ctx, args);

  return {
    commandCreate: async (args) => runPackageCreateCommand(ctx, args),
    commandAdd,
    commandGenerate: async (args) => runPackageGenerateCommand(ctx, args, { runCommandAdd: commandAdd }),
    commandRemove: async (args) => runPackageRemoveCommand(ctx, args)
  };
}

export { createPackageCommands };
