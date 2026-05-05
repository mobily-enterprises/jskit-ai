import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
__JSKIT_FEATURE_PROVIDER_REPOSITORY_IMPORT__
import { createService } from "./service.js";
import { featureActions } from "./actions.js";
__JSKIT_FEATURE_PROVIDER_ROUTE_IMPORT__

class ${option:feature-name|pascal}Provider {
  static id = "feature.${option:feature-name|kebab}";

  static dependsOn = [__JSKIT_FEATURE_PROVIDER_DEPENDS_ON__];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("${option:feature-name|pascal}Provider requires application singleton()/service()/actions().");
    }

__JSKIT_FEATURE_PROVIDER_REPOSITORY_REGISTRATION__
    app.service(
      "feature.${option:feature-name|kebab}.service",
      (_scope) => {
        return createService(__JSKIT_FEATURE_PROVIDER_SERVICE_FACTORY_ARG__);
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.${option:feature-name|kebab}.service"
        }
      })
    );
  }

__JSKIT_FEATURE_PROVIDER_BOOT_METHOD__
}

export { ${option:feature-name|pascal}Provider };
