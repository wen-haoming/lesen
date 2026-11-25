import { describe, expect, it } from "vitest";
import {
  HOME_PAGE_PATH,
  getHomePageUrl,
  isExtensionHomeTabUrl,
  isHomePagePath,
} from "./home-page";

describe("home page url", () => {
  it("uses the packaged home.html path without chrome runtime", () => {
    expect(HOME_PAGE_PATH).toBe("home.html");
    expect(getHomePageUrl()).toBe("/home.html");
  });

  it("recognizes packaged and dev preview home paths", () => {
    expect(isHomePagePath("/home.html")).toBe(true);
    expect(isHomePagePath("/src/entrypoints/home/index.html")).toBe(true);
    expect(isHomePagePath("/src/entrypoints/home")).toBe(true);
    expect(isHomePagePath("/popup.html")).toBe(false);
    expect(isHomePagePath("/sidepanel.html")).toBe(false);
    expect(isHomePagePath("/changelog.html")).toBe(false);
  });

  it("matches existing home tabs even when they already have search or hash", () => {
    const homeUrl = "chrome-extension://abc/home.html";
    expect(isExtensionHomeTabUrl("chrome-extension://abc/home.html", homeUrl)).toBe(true);
    expect(isExtensionHomeTabUrl("chrome-extension://abc/home.html?demo=timeline#changelog", homeUrl)).toBe(true);
    expect(isExtensionHomeTabUrl("chrome-extension://abc/popup.html", homeUrl)).toBe(false);
    expect(isExtensionHomeTabUrl("chrome-extension://abc/changelog.html", homeUrl)).toBe(false);
    expect(isExtensionHomeTabUrl("chrome-extension://other/home.html", homeUrl)).toBe(false);
    expect(isExtensionHomeTabUrl("https://example.com/home.html", homeUrl)).toBe(false);
  });
});
