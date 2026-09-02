export function createSingleFlight() {
  let activePromise: Promise<unknown> | null = null;

  return function runSingleFlight<T>(
    task: () => Promise<T>,
  ): Promise<T> {
    if (activePromise) {
      return activePromise as Promise<T>;
    }

    const pending = task().finally(() => {
      if (activePromise === pending) {
        activePromise = null;
      }
    });

    activePromise = pending;
    return pending;
  };
}
