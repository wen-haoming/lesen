import { describe, expect, it } from "vitest";
import { PRODUCT_DISPLAY_NAME, PRODUCT_DISPLAY_NAME_FULL, PRODUCT_HOME_TITLE } from "./product-brand";
import { SUBSCRIPTION_BACKUP_FORMAT } from "./subscription-backup";

describe("product brand", () => {
  it("exposes the current user-facing name without renaming internal identifiers", () => {
    expect(PRODUCT_DISPLAY_NAME).toBe("Lesen · 莱森");
    expect(PRODUCT_DISPLAY_NAME_FULL).toBe("Lesen · 莱森 · 多源信息聚合");
    expect(PRODUCT_HOME_TITLE).toBe("Lesen · 莱森 首页");
    expect(SUBSCRIPTION_BACKUP_FORMAT).toBe("owlivo-subscriptions");
  });
});
