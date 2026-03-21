import { SingletonApiProvider } from "../../shared/providers/singletonApiProvider.js";
import { HTTP_VALIDATORS_API } from "../../shared/validators/httpValidatorsApi.js";

class HttpValidatorsClientProvider extends SingletonApiProvider {
  static id = "validators.http.client";

  static bindingToken = "validators.http.client";

  static api = HTTP_VALIDATORS_API;

  static providerName = "HttpValidatorsClientProvider";
}

export { HttpValidatorsClientProvider };
