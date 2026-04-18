import { createTransientRetryHttpClient } from "@jskit-ai/http-runtime/client";

const workspacesWebHttpClient = createTransientRetryHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});

export { workspacesWebHttpClient };
