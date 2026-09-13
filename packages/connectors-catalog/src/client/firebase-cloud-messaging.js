import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { firebaseCloudMessagingDefinition } from "../shared/firebase-cloud-messaging.js";

function firebaseCloudMessagingWebConfiguration(settings) {
  if (settings?.clientMode !== "web") throw new TypeError("Select Include web push before configuring browser registration.");
  const values = validateSchemaPayload({ schema: firebaseCloudMessagingDefinition.settingsSchema(settings), mode: "replace" }, settings);
  return { firebaseConfig: { projectId: values.projectId, apiKey: values.apiKey, appId: values.appId, messagingSenderId: values.appId.split(":")[1] }, vapidKey: values.vapidKey };
}

export { firebaseCloudMessagingWebConfiguration };
