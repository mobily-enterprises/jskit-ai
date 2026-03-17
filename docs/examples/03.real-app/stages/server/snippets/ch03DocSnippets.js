// docs:start:formrequest_route_upgrade
router.post(
  "/api/contacts/intake",
  {
    schema: {
      body: contactIntakePreviewBodySchema,
      querystring: contactIntakePreviewQuerySchema
    },
    input: {
      body: (body) => ({
        name: body.name.trim(),
        email: body.email.trim().toLowerCase()
      }),
      query: (query) => ({
        dryRun: query?.dryRun === true
      })
    }
  },
  (request, reply) => controller.intake(request, reply)
);
// docs:end:formrequest_route_upgrade

// docs:start:formrequest_controller_upgrade
async intake(request, reply) {
  const result = await this.action.execute({
    ...request.input.body,
    ...request.input.query
  });

  return this.sendActionResult(reply, result);
}
// docs:end:formrequest_controller_upgrade
