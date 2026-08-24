import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { HTTP_VALIDATORS_API } from "../../shared/validators/httpValidatorsApi.js";

const HttpValidatorsClientProvider = defineProvider({
  id: "validators.http.client",
  provides: {
    validators: "validators.http.client"
  },
  setup() {
    return {
      validators: HTTP_VALIDATORS_API
    };
  }
});

export { HttpValidatorsClientProvider };
