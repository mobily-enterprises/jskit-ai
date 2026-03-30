import { runPackageCreateCommand } from "./packageCommands/create.js";
import { runPackageAddCommand } from "./packageCommands/add.js";
import { runPackageGenerateCommand } from "./packageCommands/generate.js";
import { runPackageUpdateCommand } from "./packageCommands/update.js";
import { runPackageMigrationsCommand } from "./packageCommands/migrations.js";
import { runPackagePositionCommand } from "./packageCommands/position.js";
import { runPackageRemoveCommand } from "./packageCommands/remove.js";

function createPackageCommands(ctx = {}) {
  const commandAdd = async (args) => runPackageAddCommand(ctx, args);

  return {
    commandCreate: async (args) => runPackageCreateCommand(ctx, args),
    commandAdd,
    commandGenerate: async (args) => runPackageGenerateCommand(ctx, args, { runCommandAdd: commandAdd }),
    commandUpdate: async (args) => runPackageUpdateCommand(ctx, args, { runCommandAdd: commandAdd }),
    commandMigrations: async (args) => runPackageMigrationsCommand(ctx, args),
    commandPosition: async (args) => runPackagePositionCommand(ctx, args),
    commandRemove: async (args) => runPackageRemoveCommand(ctx, args)
  };
}

export { createPackageCommands };
