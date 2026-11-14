/**
 * Marks a provider operation that acts on the outside world on someone's behalf: it sends an email, SMS, push
 * notification or chat message, publishes a post, books or cancels a meeting, moves money or sends an invoice, or
 * triggers another system's events. Outside production (APP_ENV), a marked operation is logged and answers
 * `{ simulated: true }` instead of sending it; reads and ordinary record changes are not marked.
 * @template {object} Operation
 * @param {Operation} operation
 * @returns {Operation & { sideEffect: true }}
 */
function sideEffect(operation) {
  return Object.freeze({
    ...operation,
    sideEffect: true
  });
}

export { sideEffect };
