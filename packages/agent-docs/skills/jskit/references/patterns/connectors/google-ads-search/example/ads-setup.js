// Compose the service in the application's existing authenticated command owner.
// No stdin value establishes the trusted application/administrator identity.
export async function dispatchAdsSetup(request, service) {
  if (request?.protocol !== "vibe64.integration-setup.command.v1" || typeof request.requestId !== "string" ||
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
  if (Buffer.byteLength(JSON.stringify(response)) > 32768) throw new Error("Advertising result exceeds the editor's display limit. Inspect Google Ads before repeating any write.");
  return response;
}
