// The query parameter on the application's return URL that names the top-up a person comes back from: Stripe
// Checkout sends them to `<returnUrl>?paymentTopUp=<topUpId>`, paid or not, and the return page confirms that top-up.
const TOP_UP_RETURN_PARAMETER = "paymentTopUp";

export { TOP_UP_RETURN_PARAMETER };
