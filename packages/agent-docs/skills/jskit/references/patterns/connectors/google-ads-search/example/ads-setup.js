/**
 * Runs one advertising setup request against the Google Ads Search service. Compose
 * the service in the application's existing authenticated command owner: no request
 * value establishes the trusted application or administrator identity.
 * @param {{ protocol: string, requestId: string, operation: string, ads: Record<string, any> }} request The parsed setup command.
 * @param {import("@jskit-ai/connectors-catalog/server/types").GoogleAdsSearchService} service
 * @param {object} host The command host's request protocol.
 * @param {string} host.protocol The protocol id that requests carry and the response echoes.
 * @param {number} host.maxResponseBytes The largest response the host accepts.
 */
export async function dispatchAdsSetup(request, service, { protocol, maxResponseBytes }) {
  if (request?.protocol !== protocol || typeof request.requestId !== "string" ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(request.requestId) || !request.ads || Array.isArray(request.ads) || typeof request.ads !== "object") {
    throw new Error("Invalid advertising setup request.");
  }
  const args = request.ads;
  let data;
  switch (request.operation) {
    case "ads-discover": data = await service.discover(args.customerId); break;
    case "ads-targets": data = await service.targets(args.customerId, args.name); break;
    case "ads-conversion": data = await service.createConversion(args); break;
    case "ads-preview": data = await service.preview(); break;
    case "ads-create": data = await service.create(args.reviewId); break;
    case "ads-campaign": data = await service.campaign(args.campaignId); break;
    case "ads-launch": data = await service.launch(args); break;
    case "ads-pause": data = await service.pause(args.campaignId); break;
    case "ads-report": data = await service.report(); break;
    default: throw new Error("Unsupported advertising setup operation.");
  }
  const response = { protocol: request.protocol, requestId: request.requestId, status: "ads", operation: request.operation, data };
  if (Buffer.byteLength(JSON.stringify(response)) > maxResponseBytes) throw new Error("Advertising result exceeds the host's response limit. Inspect Google Ads before repeating any write.");
  return response;
}
