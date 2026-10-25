import assert from "node:assert/strict";
import test from "node:test";
import { createRouteSwipeGesture } from "../src/client/support/routeSwipeGesture.js";

function createClock() {
  const clock = { time: 0, now: () => clock.time };
  return clock;
}

test("route swipe gesture navigates on a fast horizontal swipe", () => {
  const clock = createClock();
  const gesture = createRouteSwipeGesture({ now: clock.now });
  gesture.start({ pointerId: 1, clientX: 200, clientY: 100 });
  clock.time = 50;
  assert.deepEqual(gesture.move({ pointerId: 1, clientX: 185, clientY: 102 }), { claim: true, offset: 0 });
  clock.time = 100;
  assert.deepEqual(gesture.move({ pointerId: 1, clientX: 150, clientY: 104 }), { claim: true, offset: 1 });
  assert.equal(gesture.end({ pointerId: 1, clientX: 150, clientY: 104 }), 0);
});

test("route swipe gesture resolves the direction on pointer end", () => {
  const clock = createClock();
  const gesture = createRouteSwipeGesture({ now: clock.now });
  gesture.start({ pointerId: 1, clientX: 100, clientY: 100 });
  clock.time = 100;
  assert.equal(gesture.end({ pointerId: 1, clientX: 140, clientY: 100 }), -1);
  assert.equal(gesture.end({ pointerId: 1, clientX: 140, clientY: 100 }), 0);
});

test("route swipe gesture stays dropped after vertical drift even when the finger turns sideways", () => {
  const clock = createClock();
  const gesture = createRouteSwipeGesture({ now: clock.now });
  gesture.start({ pointerId: 1, clientX: 200, clientY: 100 });
  clock.time = 40;
  assert.deepEqual(gesture.move({ pointerId: 1, clientX: 200, clientY: 140 }), { claim: false, offset: 0 });
  clock.time = 120;
  assert.deepEqual(gesture.move({ pointerId: 1, clientX: 140, clientY: 110 }), { claim: false, offset: 0 });
  assert.equal(gesture.end({ pointerId: 1, clientX: 140, clientY: 110 }), 0);
});

test("route swipe gesture ignores other pointers and cancelled pointers", () => {
  const clock = createClock();
  const gesture = createRouteSwipeGesture({ now: clock.now });
  gesture.start({ pointerId: 1, clientX: 200, clientY: 100 });
  clock.time = 100;
  assert.deepEqual(gesture.move({ pointerId: 2, clientX: 100, clientY: 100 }), { claim: false, offset: 0 });
  gesture.cancel({ pointerId: 1 });
  assert.equal(gesture.end({ pointerId: 1, clientX: 100, clientY: 100 }), 0);
});
