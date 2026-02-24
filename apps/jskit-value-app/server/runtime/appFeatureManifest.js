import { createService as createDeg2radService } from "../modules/deg2rad/service.js";
import { createService as createProjectsService } from "../modules/projects/service.js";
import { createController as createDeg2radController } from "../modules/deg2rad/controller.js";
import { createController as createProjectsController } from "../modules/projects/controller.js";

const APP_FEATURE_SERVICE_DEFINITIONS = Object.freeze([
  {
    id: "deg2radService",
    create() {
      return createDeg2radService();
    }
  },
  {
    id: "projectsService",
    create({ repositories }) {
      return createProjectsService({
        projectsRepository: repositories.projectsRepository
      });
    }
  }
]);

const APP_FEATURE_CONTROLLER_DEFINITIONS = Object.freeze([
  {
    id: "deg2rad",
    create({ services }) {
      return createDeg2radController({
        deg2radService: services.deg2radService,
        deg2radHistoryService: services.deg2radHistoryService,
        billingService: services.billingService
      });
    }
  },
  {
    id: "projects",
    create({ services }) {
      return createProjectsController({
        projectsService: services.projectsService,
        realtimeEventsService: services.realtimeEventsService,
        billingService: services.billingService
      });
    }
  }
]);

const APP_FEATURE_RUNTIME_BUNDLE = Object.freeze({
  serviceDefinitions: APP_FEATURE_SERVICE_DEFINITIONS,
  controllerDefinitions: APP_FEATURE_CONTROLLER_DEFINITIONS
});

export { APP_FEATURE_SERVICE_DEFINITIONS, APP_FEATURE_CONTROLLER_DEFINITIONS, APP_FEATURE_RUNTIME_BUNDLE };
