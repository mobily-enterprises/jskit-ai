import { createCommandTracker } from "@jskit-ai/realtime-client-runtime";

const commandTracker = createCommandTracker();
const __testables = commandTracker.__testables;

export { commandTracker, __testables };
