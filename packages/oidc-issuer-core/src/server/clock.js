/** The hub's clock when its caller passes none: the system time. */
function systemClock() {
  return new Date();
}

export { systemClock };
