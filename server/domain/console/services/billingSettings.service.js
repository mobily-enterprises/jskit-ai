import { AppError } from "../../../lib/errors.js";
import { CONSOLE_BILLING_PERMISSIONS } from "../policies/roles.js";

const PAID_PLAN_CHANGE_POLICY_REQUIRED_NOW = "required_now";
const PAID_PLAN_CHANGE_POLICY_ALLOW_WITHOUT_PAYMENT_METHOD = "allow_without_payment_method";

function normalizeOptionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function normalizePaidPlanChangePaymentMethodPolicy(value) {
  const normalized = normalizeOptionalString(value).toLowerCase();
  if (normalized === PAID_PLAN_CHANGE_POLICY_ALLOW_WITHOUT_PAYMENT_METHOD) {
    return PAID_PLAN_CHANGE_POLICY_ALLOW_WITHOUT_PAYMENT_METHOD;
  }
  if (normalized === PAID_PLAN_CHANGE_POLICY_REQUIRED_NOW || !normalized) {
    return PAID_PLAN_CHANGE_POLICY_REQUIRED_NOW;
  }

  throw new AppError(400, "Validation failed.", {
    details: {
      fieldErrors: {
        paidPlanChangePaymentMethodPolicy:
          "paidPlanChangePaymentMethodPolicy must be 'required_now' or 'allow_without_payment_method'."
      }
    }
  });
}

function resolveBillingSettingsFromConsoleSettings(consoleSettings) {
  const features = consoleSettings?.features && typeof consoleSettings.features === "object" ? consoleSettings.features : {};
  const billingFeatures = features?.billing && typeof features.billing === "object" ? features.billing : {};

  return {
    paidPlanChangePaymentMethodPolicy: normalizePaidPlanChangePaymentMethodPolicy(
      billingFeatures.paidPlanChangePaymentMethodPolicy
    )
  };
}

function mapBillingSettingsResponse(consoleSettings) {
  return {
    settings: resolveBillingSettingsFromConsoleSettings(consoleSettings)
  };
}

function createBillingSettingsService({ requirePermission, ensureConsoleSettings, consoleSettingsRepository }) {
  if (typeof requirePermission !== "function") {
    throw new Error("requirePermission must be a function.");
  }
  if (typeof ensureConsoleSettings !== "function") {
    throw new Error("ensureConsoleSettings must be a function.");
  }
  if (!consoleSettingsRepository || typeof consoleSettingsRepository.update !== "function") {
    throw new Error("consoleSettingsRepository.update is required.");
  }

  async function getBillingSettings(user) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);
    const consoleSettings = await ensureConsoleSettings();
    return mapBillingSettingsResponse(consoleSettings);
  }

  async function updateBillingSettings(user, payload) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);
    const body = payload && typeof payload === "object" ? payload : {};

    if (!Object.hasOwn(body, "paidPlanChangePaymentMethodPolicy")) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            paidPlanChangePaymentMethodPolicy: "paidPlanChangePaymentMethodPolicy is required."
          }
        }
      });
    }

    const normalizedPolicy = normalizePaidPlanChangePaymentMethodPolicy(body.paidPlanChangePaymentMethodPolicy);
    const currentSettings = await ensureConsoleSettings();
    const baseFeatures = currentSettings?.features && typeof currentSettings.features === "object" ? currentSettings.features : {};
    const baseBilling = baseFeatures?.billing && typeof baseFeatures.billing === "object" ? baseFeatures.billing : {};
    const nextFeatures = {
      ...baseFeatures,
      billing: {
        ...baseBilling,
        paidPlanChangePaymentMethodPolicy: normalizedPolicy
      }
    };

    const updatedSettings = await consoleSettingsRepository.update({
      features: nextFeatures
    });

    return mapBillingSettingsResponse(updatedSettings);
  }

  return {
    getBillingSettings,
    updateBillingSettings
  };
}

export {
  PAID_PLAN_CHANGE_POLICY_REQUIRED_NOW,
  PAID_PLAN_CHANGE_POLICY_ALLOW_WITHOUT_PAYMENT_METHOD,
  normalizePaidPlanChangePaymentMethodPolicy,
  resolveBillingSettingsFromConsoleSettings,
  mapBillingSettingsResponse,
  createBillingSettingsService
};
