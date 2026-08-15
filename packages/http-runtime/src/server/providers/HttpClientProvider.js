import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import * as httpClient from "../../shared/clientRuntime/index.js";

const HttpClientProvider = defineProvider({
  id: "runtime.http-client",
  provides: {
    httpClient: "runtime.http-client"
  },
  setup() {
    return {
      httpClient: Object.freeze({ ...httpClient })
    };
  }
});

export { HttpClientProvider };
