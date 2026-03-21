import { SingletonApiProvider } from "../../shared/providers/singletonApiProvider.js";
import { HTTP_VALIDATORS_API } from "../../shared/validators/httpValidatorsApi.js";

class HttpValidatorsServiceProvider extends SingletonApiProvider {
  static id = "validators.http";

  static bindingToken = "validators.http";

  static api = HTTP_VALIDATORS_API;

  static providerName = "HttpValidatorsServiceProvider";
}

export { HttpValidatorsServiceProvider };
