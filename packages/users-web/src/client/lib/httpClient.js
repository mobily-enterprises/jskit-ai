import { createHttpClient } from "@jskit-ai/http-runtime/client";

const usersWebHttpClient = createHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});

export { usersWebHttpClient };
