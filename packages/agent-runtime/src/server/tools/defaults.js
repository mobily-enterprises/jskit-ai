import { goalTools } from "../goals.js";
import { planningTools } from "../planning.js";
import { askInReplyTools, askTools } from "./ask.js";
import { commandTools } from "./commands.js";
import { fileTools } from "./files.js";

/**
 * The tools an agent has unless it's given others, for one turn in one conversation: the
 * workspace's files (`root`), commands there (`commands`, from createCommands), a to-do list and
 * notes (`planning`, the app's store for them; the to-do card needs `post`), goals (`goals`, from
 * goals.operationsFor) and asking the person (a question card with `post`, otherwise in the reply).
 * Each other part is left out when what it needs isn't given.
 * @param {object} options
 * @param {string} options.root
 * @param {import("../types.js").AgentCommands | null} [options.commands]
 * @param {import("../types.js").AgentPlanning | null} [options.planning]
 * @param {number | string} options.conversationId
 * @param {((messages: object[]) => Promise<unknown>) | null} [options.post]
 * @param {import("../types.js").AgentGoalOperations | null} [options.goals]
 */
export function defaultTools({ root, commands = null, planning = null, conversationId, post = null, goals = null }) {
  return {
    ...fileTools({ root }),
    ...(commands ? commandTools({ commands, conversationId, root }) : {}),
    ...(planning ? planningTools({ planning, conversationId, post }) : {}),
    ...(goals ? goalTools(goals) : {}),
    ...(post ? askTools({ post }) : askInReplyTools())
  };
}
