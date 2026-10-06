import { defineAssistantSurface } from "@jskit-ai/assistant-runtime/shared";

// Application-owned identities, labels and the existing home surface.
export const conversations = Object.freeze([
  { id: "planning", label: "Planning" },
  { id: "notes", label: "Notes" },
  { id: "research", label: "Research" },
  { id: "writing", label: "Writing" },
  { id: "review", label: "Review" }
]);

export const appConfig = Object.freeze({
  ...defineAssistantSurface("home"),
  realtimeClient: { options: { transports: ["websocket"] } }
});
