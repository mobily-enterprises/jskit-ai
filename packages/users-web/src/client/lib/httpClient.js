import { createTransientRetryHttpClient } from "@jskit-ai/http-runtime/client";

const usersWebHttpClient = createTransientRetryHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});

export { usersWebHttpClient };
