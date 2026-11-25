import { describe, expect, it } from "vitest";
import { PRODUCT_STORE_URL } from "./product-brand";
import { OWLIVO_CONTACT_LABEL, OWLIVO_CONTACT_URL, OWLIVO_PRIVACY_URL } from "./product-contact";

describe("public product contact", () => {
  it("uses the existing store instead of exposing a personal mailbox", () => {
    expect(OWLIVO_CONTACT_LABEL).toBe("Chrome 商店反馈");
    expect(OWLIVO_CONTACT_URL).toBe(PRODUCT_STORE_URL);
    expect(OWLIVO_CONTACT_URL).not.toMatch(/mailto:/);
    expect(OWLIVO_PRIVACY_URL).toBe("privacy.html");
  });
});
