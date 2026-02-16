const PERPETUAL_MODE_ERROR = "Perpetual calculations are only supported for present value (PV).";

function toNumber(value) {
  return Number(value);
}

export function validateAnnuityForm(form) {
  const isPerpetual = form?.isPerpetual === true;
  if (isPerpetual && String(form?.mode) !== "pv") {
    return {
      ok: false,
      message: PERPETUAL_MODE_ERROR
    };
  }

  return {
    ok: true,
    message: ""
  };
}

export function buildAnnuityPayload(form) {
  const isPerpetual = form?.isPerpetual === true;

  return {
    mode: String(form?.mode || ""),
    payment: toNumber(form?.payment),
    annualRate: toNumber(form?.annualRate),
    annualGrowthRate: form?.useGrowth ? toNumber(form?.annualGrowthRate) : 0,
    years: isPerpetual ? undefined : toNumber(form?.years),
    paymentsPerYear: toNumber(form?.paymentsPerYear),
    timing: String(form?.timing || ""),
    isPerpetual
  };
}

export const __testables = {
  PERPETUAL_MODE_ERROR
};
