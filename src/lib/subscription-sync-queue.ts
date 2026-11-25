let queueTail: Promise<void> = Promise.resolve();

/** Serialize all background persona/account sync mutations without owning auth. */
export function resetSubscriptionSyncQueueForTests(): void {
  queueTail = Promise.resolve();
}

export function enqueueSubscriptionSync<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueTail.then(operation, operation);
  queueTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
