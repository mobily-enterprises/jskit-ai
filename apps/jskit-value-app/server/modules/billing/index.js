import {
  transaction,
  findBillableEntityById,
  findBillableEntityByWorkspaceId,
  findBillableEntityByTypeRef,
  ensureBillableEntity,
  ensureBillableEntityByScope,
  findWorkspaceContextForBillableEntity
} from "./repository.js";

const billingRepository = Object.freeze({
  transaction,
  findBillableEntityById,
  findBillableEntityByWorkspaceId,
  findBillableEntityByTypeRef,
  ensureBillableEntity,
  ensureBillableEntityByScope,
  findWorkspaceContextForBillableEntity
});

function createRepository() {
  return billingRepository;
}

export { createRepository };
export { createService as createBillingProvidersModule } from "./lib/providers/index.js";
