import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { HTTP_VALIDATORS_API } from "../../shared/validators/httpValidatorsApi.js";

const HttpValidatorsProvider = defineProvider({
  id: "validators.http",
  provides: {
    validators: "validators.http"
  },
  setup() {
    return {
      validators: HTTP_VALIDATORS_API
    };
  }
});

export { HttpValidatorsProvider };
