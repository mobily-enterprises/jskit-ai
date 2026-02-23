import DecimalBase from "decimal.js";
import { AppError } from "../../lib/errors.js";

const Decimal = DecimalBase.clone({
  precision: 50,
  rounding: DecimalBase.ROUND_HALF_UP
});

const DEG2RAD_OPERATION = "DEG2RAD";
const DEG2RAD_PI = new Decimal(String(Math.PI));
const DEG2RAD_DIVISOR = new Decimal(180);

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validateAndNormalizeInput(payload) {
  const DEG2RAD_operation = String(payload.DEG2RAD_operation || "").trim();
  const DEG2RAD_degrees = toFiniteNumber(payload.DEG2RAD_degrees);
  const fieldErrors = {};

  if (DEG2RAD_operation !== DEG2RAD_OPERATION) {
    fieldErrors.DEG2RAD_operation = "DEG2RAD_operation must be 'DEG2RAD'.";
  }

  if (!Number.isFinite(DEG2RAD_degrees)) {
    fieldErrors.DEG2RAD_degrees = "DEG2RAD_degrees must be a finite number.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors
      }
    });
  }

  const DEG2RAD_degreesDecimal = new Decimal(DEG2RAD_degrees);

  return {
    DEG2RAD_degrees: DEG2RAD_degreesDecimal.toFixed(12),
    DEG2RAD_degreesDecimal
  };
}

function calculateDeg2rad(input) {
  const DEG2RAD_radiansDecimal = input.DEG2RAD_degreesDecimal.mul(DEG2RAD_PI).div(DEG2RAD_DIVISOR);

  if (!DEG2RAD_radiansDecimal.isFinite()) {
    throw new AppError(422, "DEG2RAD conversion produced an invalid value.");
  }

  return {
    DEG2RAD_operation: DEG2RAD_OPERATION,
    DEG2RAD_formula: "DEG2RAD(x) = x * PI / 180",
    DEG2RAD_degrees: input.DEG2RAD_degrees,
    DEG2RAD_radians: DEG2RAD_radiansDecimal.toFixed(12)
  };
}

function createService() {
  return {
    validateAndNormalizeInput,
    calculateDeg2rad
  };
}

export { createService, validateAndNormalizeInput, calculateDeg2rad };
