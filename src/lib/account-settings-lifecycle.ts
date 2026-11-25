export type AccountIdentity = { id: string | null; status: string };

/** Small lifecycle primitive shared by AccountSettings and its regression tests. */
export function invalidateActionsForIdentityChange<T extends AccountIdentity>(
  previous: T,
  next: T,
  invalidate: () => void,
  resetBusy: () => void,
): T {
  if (previous.id === next.id && previous.status === next.status) return previous;
  invalidate();
  resetBusy();
  return next;
}
