import { z } from "zod";
import { createTool } from "@jskit-ai/agent/server";

// What the model sees of the ask_user tool, whichever way the chat shows the question.
const ASK_USER = Object.freeze({
  id: "ask_user",
  description: "Ask the person a question you need answered before you can go on, with a few answers to pick from when there are obvious ones; then end your reply and wait. Only for what you can't reasonably decide or find out yourself.",
  inputSchema: z.object({
    question: z.string().min(3).max(1000),
    options: z.array(z.string().min(1).max(100)).max(6).optional()
  })
});

/**
 * Asking the person something only they can decide, in a chat that shows questions as cards: the
 * question is a card with the answers to pick from, and the answer is the person's next message.
 * @param {object} options
 * @param {(messages: object[]) => Promise<unknown>} options.post Shows messages in the chat.
 */
export function askTools({ post }) {
  async function askUser({ question, options = [] }) {
    await post([{ kind: "question", role: "bot", body: { question, options } }]);
    return { status: "asked", note: "The person sees the question. End your reply now in one short line, and carry on when they answer." };
  }

  return {
    askUser: createTool(Object.freeze({
      ...ASK_USER,
      execute: (input) => askUser(input)
    }))
  };
}

/**
 * Asking the person something only they can decide, in a chat that shows no question cards: the
 * question goes in the reply, and the answer is the person's next message.
 */
export function askInReplyTools() {
  function askUser() {
    return { status: "ask in your reply", note: "Put the question in your reply, end it there, and carry on when they answer." };
  }

  return {
    askUser: createTool(Object.freeze({
      ...ASK_USER,
      execute: () => askUser()
    }))
  };
}
