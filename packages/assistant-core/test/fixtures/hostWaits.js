// Explores a turn owner's interleavings with the work that can arrive while it
// waits on its host: a Stop, a person's steer, the next turn. A turn owner's
// only interleavings are those waits (publishing, saving, admission storage);
// everything else runs to completion in one step.
//
// `scenario({ intervention, wait })` drives one fresh owner through a script and
// asserts its own invariants. Its host calls `await wait(label, intervene)` at
// every wait of the script under test, where `intervene` applies `intervention`
// to that scenario's state; the checks that follow the script make no waits.
// The explorer runs the script once with no intervention to list its waits,
// then once per intervention and wait, applying the intervention inside that
// wait. A run that has not finished within `limitMs` fails as hung. It returns
// the labels of the waits it explored.
export async function exploreHostWaits(scenario, interventions, { limitMs = 10_000 } = {}) {
  const waits = [];
  await scenario({ intervention: null, wait: async label => { waits.push(label); } });
  for (const intervention of interventions) {
    for (let index = 0; index < waits.length; index += 1) {
      let seen = 0;
      let timer;
      try {
        await Promise.race([
          scenario({ intervention, async wait(_label, intervene) {
            if (seen++ === index) await intervene();
          } }),
          new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`hung for ${limitMs} ms`)), limitMs);
          })
        ]);
      } catch (error) {
        error.message = `${intervention} inside wait ${index} (${waits[index]}): ${error.message}`;
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return waits;
}
