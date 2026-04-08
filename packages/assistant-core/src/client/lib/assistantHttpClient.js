import { createHttpClient } from "@jskit-ai/http-runtime/client";

const assistantHttpClient = createHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});

export { assistantHttpClient };
