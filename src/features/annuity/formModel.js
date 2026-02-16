export const modeOptions = [
  { title: "Future Value (FV)", value: "fv" },
  { title: "Present Value (PV)", value: "pv" }
];

export const timingOptions = [
  { title: "End of period (ordinary annuity)", value: "ordinary" },
  { title: "Beginning of period (annuity due)", value: "due" }
];

export const pageSizeOptions = [10, 25, 50];

export function createDefaultAnnuityForm() {
  return {
    mode: "fv",
    payment: 500,
    annualRate: 6,
    annualGrowthRate: 3,
    isPerpetual: false,
    years: 20,
    paymentsPerYear: 12,
    timing: "ordinary",
    useGrowth: false
  };
}
