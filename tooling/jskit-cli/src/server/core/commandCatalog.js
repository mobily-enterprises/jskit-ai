const KNOWN_COMMAND_IDS = Object.freeze([
  "help",
  "create",
  "generate",
  "list",
  "list-placements",
  "list-link-items",
  "show",
  "view",
  "migrations",
  "add",
  "position",
  "update",
  "remove",
  "doctor",
  "lint-descriptors"
]);

const KNOWN_COMMANDS = new Set(KNOWN_COMMAND_IDS);

const COMMAND_ALIASES = Object.freeze({
  view: "show",
  ls: "list",
  gen: "generate",
  lp: "list-placements",
  lpct: "list-link-items",
  "list-placement-component-tokens": "list-link-items"
});

function resolveCommandAlias(rawCommand) {
  const command = String(rawCommand || "").trim();
  if (!command) {
    return "";
  }
  return COMMAND_ALIASES[command] || command;
}

function isKnownCommandName(rawCommand) {
  const command = resolveCommandAlias(rawCommand);
  if (!command) {
    return false;
  }
  return KNOWN_COMMANDS.has(command);
}

export {
  KNOWN_COMMAND_IDS,
  resolveCommandAlias,
  isKnownCommandName
};
