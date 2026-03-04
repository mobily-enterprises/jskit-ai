const COUNTER = "docs.examples.02.singleton.counter";

class SingletonExampleProvider {
  static id = "docs.examples.02.singleton";

  register(app) {
    app.singleton(COUNTER, () => {
      let count = 0;
      return {
        increment() {
          count += 1;
          return count;
        },
        current() {
          return count;
        }
      };
    });
  }

  boot(app) {
    const firstResolve = app.make(COUNTER);
    const secondResolve = app.make(COUNTER);

    // Example: 1
    const firstIncrement = firstResolve.increment();
    // Example: 2
    const secondIncrement = secondResolve.increment();
    const sharedObject = firstResolve === secondResolve;
    const finalValue = firstResolve.current();

    if (!sharedObject || firstIncrement !== 1 || secondIncrement !== 2 || finalValue !== 2) {
      throw new Error("SingletonExampleProvider expected a shared singleton instance with stable state.");
    }
  }
}

export { SingletonExampleProvider };
