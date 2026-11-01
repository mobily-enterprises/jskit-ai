import { defineProvider } from "../../shared/capabilities/defineProvider.js";
import { createEventRuntime } from "./eventRuntime.js";

const EventProvider = defineProvider({
  id: "runtime.events",
  provides: {
    events: "runtime.events"
  },
  setup() {
    return { events: createEventRuntime() };
  }
});

export { EventProvider };
