import { describe, expect, it, vi } from "vitest";
import { invalidateActionsForIdentityChange } from "./account-settings-lifecycle";

describe("account settings lifecycle", () => {
  it("invalidates stale actions and clears busy without requiring unmount", () => {
    let identity = { id: "account-a", status: "signed_in" };
    let generation = 4;
    let busy = true;
    const invalidate = vi.fn(() => {
      generation++;
    });
    const clearBusy = vi.fn(() => {
      busy = false;
    });
    identity = invalidateActionsForIdentityChange(
      identity,
      { id: null, status: "signed_out" },
      invalidate,
      clearBusy,
    );
    expect(identity).toEqual({ id: null, status: "signed_out" });
    expect(generation).toBe(5);
    expect(busy).toBe(false);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(clearBusy).toHaveBeenCalledTimes(1);
  });

  it("keeps lifecycle stable across ordinary refreshes", () => {
    const invalidate = vi.fn();
    const clearBusy = vi.fn();
    const before = { id: "account-a", status: "signed_in" };
    expect(invalidateActionsForIdentityChange(before, { ...before }, invalidate, clearBusy)).toBe(
      before,
    );
    expect(invalidate).not.toHaveBeenCalled();
    expect(clearBusy).not.toHaveBeenCalled();
  });
});
