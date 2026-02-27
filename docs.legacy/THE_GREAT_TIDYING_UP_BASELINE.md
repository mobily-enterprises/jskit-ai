# THE_GREAT_TIDYING_UP_BASELINE

Generated: 2026-02-27T01:42:55Z

## `rg -n "web-runtime-core/apiClients" apps packages`
```text
apps/jskit-value-app/src/framework/moduleRegistry.base.js:9:} from "@jskit-ai/web-runtime-core/apiClients";
apps/jskit-value-app/tests/moduleContracts.test.js:401:    "@jskit-ai/web-runtime-core/apiClients/authApi",
apps/jskit-value-app/tests/moduleContracts.test.js:402:    "@jskit-ai/web-runtime-core/apiClients/alertsApi",
apps/jskit-value-app/tests/moduleContracts.test.js:403:    "@jskit-ai/web-runtime-core/apiClients/billingApi",
apps/jskit-value-app/tests/moduleContracts.test.js:405:    "@jskit-ai/web-runtime-core/apiClients/workspaceApi",
apps/jskit-value-app/tests/moduleContracts.test.js:406:    "@jskit-ai/web-runtime-core/apiClients/consoleApi",
apps/jskit-value-app/tests/moduleContracts.test.js:408:    "@jskit-ai/web-runtime-core/apiClients/settingsApi",
apps/jskit-value-app/tests/moduleContracts.test.js:409:    "@jskit-ai/web-runtime-core/apiClients/historyApi"
```

## `rg -n "console.billing.|console.ai." packages/workspace/workspace-console-service-core/src/shared/actions/console.contributor.js`
```text
113:  "console.billing.settings.read": "none",
114:  "console.billing.settings.update": "optional",
115:  "console.billing.events.list": "none",
116:  "console.billing.plans.list": "none",
117:  "console.billing.products.list": "none",
118:  "console.billing.plan.create": "optional",
119:  "console.billing.product.create": "optional",
120:  "console.billing.provider_prices.list": "none",
121:  "console.billing.plan.update": "optional",
122:  "console.billing.product.update": "optional",
123:  "console.billing.entitlement_definitions.list": "none",
124:  "console.billing.entitlement_definition.get": "none",
125:  "console.billing.entitlement_definition.create": "optional",
126:  "console.billing.entitlement_definition.update": "optional",
127:  "console.billing.entitlement_definition.delete": "required",
128:  "console.billing.plan.archive": "required",
129:  "console.billing.plan.unarchive": "required",
130:  "console.billing.plan.delete": "required",
131:  "console.billing.product.archive": "required",
132:  "console.billing.product.unarchive": "required",
133:  "console.billing.product.delete": "required",
134:  "console.billing.purchases.list": "none",
135:  "console.billing.purchase.refund": "required",
136:  "console.billing.purchase.void": "required",
137:  "console.billing.purchase.correction.create": "required",
138:  "console.billing.plan_assignments.list": "none",
139:  "console.billing.plan_assignment.create": "required",
140:  "console.billing.plan_assignment.update": "required",
141:  "console.billing.plan_assignment.cancel": "required",
142:  "console.billing.subscriptions.list": "none",
143:  "console.billing.subscription.change_plan": "required",
144:  "console.billing.subscription.cancel": "required",
145:  "console.billing.subscription.cancel_at_period_end": "required"
152:  CONSOLE_BILLING: "console_billing"
159:  CONSOLE_BILLING_UPDATED: "console.billing.updated"
212:  "console.billing.entitlement_definitions.list": Object.freeze({
213:    description: "List entitlement definitions for console billing catalog administration.",
225:  "console.billing.entitlement_definition.get": Object.freeze({
234:  "console.billing.entitlement_definition.create": Object.freeze({
250:  "console.billing.entitlement_definition.update": Object.freeze({
267:  "console.billing.entitlement_definition.delete": Object.freeze({
276:  "console.billing.plan.archive": Object.freeze({
285:  "console.billing.plan.unarchive": Object.freeze({
294:  "console.billing.plan.delete": Object.freeze({
303:  "console.billing.product.archive": Object.freeze({
312:  "console.billing.product.unarchive": Object.freeze({
321:  "console.billing.product.delete": Object.freeze({
330:  "console.billing.purchases.list": Object.freeze({
347:  "console.billing.purchase.refund": Object.freeze({
358:  "console.billing.purchase.void": Object.freeze({
369:  "console.billing.purchase.correction.create": Object.freeze({
383:  "console.billing.plan_assignments.list": Object.freeze({
397:  "console.billing.plan_assignment.create": Object.freeze({
413:  "console.billing.plan_assignment.update": Object.freeze({
427:  "console.billing.plan_assignment.cancel": Object.freeze({
438:  "console.billing.subscriptions.list": Object.freeze({
451:  "console.billing.subscription.change_plan": Object.freeze({
464:  "console.billing.subscription.cancel": Object.freeze({
474:  "console.billing.subscription.cancel_at_period_end": Object.freeze({
561:  if (normalizedActionId.startsWith("console.billing.")) {
925:      id: "console.billing.settings.read",
933:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.settings.read"],
935:        actionName: "console.billing.settings.read"
943:      id: "console.billing.settings.update",
951:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.settings.update"],
953:        actionName: "console.billing.settings.update"
961:      id: "console.billing.events.list",
969:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.events.list"],
971:        actionName: "console.billing.events.list"
979:      id: "console.billing.plans.list",
987:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plans.list"],
989:        actionName: "console.billing.plans.list"
997:      id: "console.billing.products.list",
1005:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.products.list"],
1007:        actionName: "console.billing.products.list"
1015:      id: "console.billing.plan.create",
1023:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan.create"],
1025:        actionName: "console.billing.plan.create"
1033:      id: "console.billing.product.create",
1041:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.product.create"],
1043:        actionName: "console.billing.product.create"
1051:      id: "console.billing.provider_prices.list",
1059:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.provider_prices.list"],
1061:        actionName: "console.billing.provider_prices.list"
1069:      id: "console.billing.plan.update",
1077:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan.update"],
1079:        actionName: "console.billing.plan.update"
1088:      id: "console.billing.product.update",
1096:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.product.update"],
1098:        actionName: "console.billing.product.update"
1107:      id: "console.billing.entitlement_definitions.list",
1115:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.entitlement_definitions.list"],
1117:        actionName: "console.billing.entitlement_definitions.list"
1125:      id: "console.billing.entitlement_definition.get",
1133:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.entitlement_definition.get"],
1135:        actionName: "console.billing.entitlement_definition.get"
1146:      id: "console.billing.entitlement_definition.create",
1154:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.entitlement_definition.create"],
1156:        actionName: "console.billing.entitlement_definition.create"
1164:      id: "console.billing.entitlement_definition.update",
1172:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.entitlement_definition.update"],
1174:        actionName: "console.billing.entitlement_definition.update"
1183:      id: "console.billing.entitlement_definition.delete",
1191:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.entitlement_definition.delete"],
1193:        actionName: "console.billing.entitlement_definition.delete"
1208:      id: "console.billing.plan.archive",
1216:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan.archive"],
1218:        actionName: "console.billing.plan.archive"
1233:      id: "console.billing.plan.unarchive",
1241:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan.unarchive"],
1243:        actionName: "console.billing.plan.unarchive"
1258:      id: "console.billing.plan.delete",
1266:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan.delete"],
1268:        actionName: "console.billing.plan.delete"
1283:      id: "console.billing.product.archive",
1291:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.product.archive"],
1293:        actionName: "console.billing.product.archive"
1308:      id: "console.billing.product.unarchive",
1316:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.product.unarchive"],
1318:        actionName: "console.billing.product.unarchive"
1333:      id: "console.billing.product.delete",
1341:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.product.delete"],
1343:        actionName: "console.billing.product.delete"
1358:      id: "console.billing.purchases.list",
1366:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.purchases.list"],
1368:        actionName: "console.billing.purchases.list"
1376:      id: "console.billing.purchase.refund",
1384:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.purchase.refund"],
1386:        actionName: "console.billing.purchase.refund"
1405:      id: "console.billing.purchase.void",
1413:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.purchase.void"],
1415:        actionName: "console.billing.purchase.void"
1434:      id: "console.billing.purchase.correction.create",
1442:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.purchase.correction.create"],
1444:        actionName: "console.billing.purchase.correction.create"
1463:      id: "console.billing.plan_assignments.list",
1471:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan_assignments.list"],
1473:        actionName: "console.billing.plan_assignments.list"
1481:      id: "console.billing.plan_assignment.create",
1489:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan_assignment.create"],
1491:        actionName: "console.billing.plan_assignment.create"
1499:      id: "console.billing.plan_assignment.update",
1507:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan_assignment.update"],
1509:        actionName: "console.billing.plan_assignment.update"
1518:      id: "console.billing.plan_assignment.cancel",
1526:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan_assignment.cancel"],
1528:        actionName: "console.billing.plan_assignment.cancel"
1543:      id: "console.billing.subscriptions.list",
1551:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.subscriptions.list"],
1553:        actionName: "console.billing.subscriptions.list"
1561:      id: "console.billing.subscription.change_plan",
1569:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.subscription.change_plan"],
1571:        actionName: "console.billing.subscription.change_plan"
1586:      id: "console.billing.subscription.cancel",
1594:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.subscription.cancel"],
1596:        actionName: "console.billing.subscription.cancel"
1611:      id: "console.billing.subscription.cancel_at_period_end",
1619:      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.subscription.cancel_at_period_end"],
1621:        actionName: "console.billing.subscription.cancel_at_period_end"
1663:        id: "console.ai.transcripts.list",
1673:          actionName: "console.ai.transcripts.list"
1681:        id: "console.ai.transcript.messages.get",
1691:          actionName: "console.ai.transcript.messages.get"
1701:        id: "console.ai.transcripts.export",
1711:          actionName: "console.ai.transcripts.export"
```

## `rg -n "function createBillingSubsystem|function createSocialOutboxWorkerRuntimeService|throwEnabledSubsystemStartupPreflightError" apps/jskit-value-app/server/runtime/services.js`
```text
168:function createSocialOutboxWorkerRuntimeService({
331:function throwEnabledSubsystemStartupPreflightError({ env, aiPolicyConfig, billingPolicyConfig, socialPolicyConfig }) {
399:function createBillingSubsystem({ repositories, services, env, repositoryConfig }) {
583:      throwEnabledSubsystemStartupPreflightError({
1069:  throwEnabledSubsystemStartupPreflightError,
```
