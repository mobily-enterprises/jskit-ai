import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import * as httpClientRuntime from "../../shared/clientRuntime/index.js";

const HTTP_CLIENT_RUNTIME_CLIENT_API = Object.freeze({
  ...httpClientRuntime
});

const HttpClientRuntimeClientProvider = defineProvider({
  id: "runtime.http-client.client",
  provides: {
    httpClient: "runtime.http-client.client"
  },
  setup() {
    return {
      httpClient: HTTP_CLIENT_RUNTIME_CLIENT_API
    };
  }
});

export { HttpClientRuntimeClientProvider };
