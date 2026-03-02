import {
  createService as createDeg2radModuleService,
  createController as createDeg2radController
} from "../modules/deg2rad/index.js";
import {
  createService as createProjectsModuleService,
  createController as createProjectsController
} from "../modules/projects/index.js";

const APP_FEATURE_SERVICE_DEFINITIONS = Object.freeze([
  {
    id: "deg2radService",
    create() {
      const { service } = createDeg2radModuleService();
      return service;
    }
  },
  {
    id: "projectsService",
    create({ repositories }) {
      const { service } = createProjectsModuleService({
        projectsRepository: repositories.projectsRepository
      });
      return service;
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
        billingService: services.billingService,
        actionExecutor: services.actionExecutor
      });
    }
  },
  {
    id: "projects",
    create({ services }) {
      return createProjectsController({
        projectsService: services.projectsService,
        realtimeEventsService: services.realtimeEventsService,
        billingService: services.billingService,
        actionExecutor: services.actionExecutor
      });
    }
  }
]);

const APP_FEATURE_RUNTIME_BUNDLE = Object.freeze({
  serviceDefinitions: APP_FEATURE_SERVICE_DEFINITIONS,
  controllerDefinitions: APP_FEATURE_CONTROLLER_DEFINITIONS
});

export { APP_FEATURE_SERVICE_DEFINITIONS, APP_FEATURE_CONTROLLER_DEFINITIONS, APP_FEATURE_RUNTIME_BUNDLE };
