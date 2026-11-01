import { goalTools } from "../goals.js";
import { planningTools } from "../planning.js";
import { askTools } from "./ask.js";
import { commandTools } from "./commands.js";
import { fileTools } from "./files.js";

// The tools an agent has unless it's given others, for one turn in one conversation: the
// workspace's files (`root`), commands there (`commands`, from createCommands), a to-do list and
// notes (`knex`, `tables`; the to-do card needs `post`), goals (`goals`, from
// goals.operationsFor) and asking the person. Each part is left out when what it needs isn't given.
export function defaultTools({ root, commands = null, knex = null, conversationId, post = null, goals = null, tables }) {
  return {
    ...fileTools({ root }),
    ...(commands ? commandTools({ commands, conversationId, root }) : {}),
    ...(knex ? planningTools({ knex, conversationId, post, tables }) : {}),
    ...(goals ? goalTools(goals) : {}),
    ...askTools({ post })
  };
}
