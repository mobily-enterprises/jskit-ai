import { toDateOrNull } from "@jskit-ai/billing-core";

function pickLaterDate(left, right) {
  const leftDate = toDateOrNull(left);
  const rightDate = toDateOrNull(right);

  if (!leftDate) {
    return rightDate;
  }
  if (!rightDate) {
    return leftDate;
  }

  return leftDate.getTime() >= rightDate.getTime() ? leftDate : rightDate;
}

export { pickLaterDate };
