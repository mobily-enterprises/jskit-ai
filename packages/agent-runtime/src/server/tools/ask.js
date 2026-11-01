import { z } from "zod";
import { createTool } from "@jskit-ai/agent/server";

// Asking the person something only they can decide. With `post` (a chat that shows it), the
// question is a card with the answers to pick from; the answer is the person's next message.
export function askTools({ post = null } = {}) {
  return {
    askUser: createTool({
      id: "ask_user",
      description: "Ask the person a question you need answered before you can go on, with a few answers to pick from when there are obvious ones; then end your reply and wait. Only for what you can't reasonably decide or find out yourself.",
      inputSchema: z.object({
        question: z.string().min(3).max(1000),
        options: z.array(z.string().min(1).max(100)).max(6).optional()
      }),
      execute: async ({ question, options = [] }) => {
        if (!post) return { status: "ask in your reply", note: "Put the question in your reply, end it there, and carry on when they answer." };
        await post([{ kind: "question", role: "bot", body: { question, options } }]);
        return { status: "asked", note: "The person sees the question. End your reply now in one short line, and carry on when they answer." };
      }
    })
  };
}
