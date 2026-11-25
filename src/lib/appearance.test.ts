import { describe, expect, it } from "vitest";
import {
  READING_FONT_OPTIONS,
  READING_FONTS,
  READING_SIZE_OPTIONS,
  READING_SIZES,
  THEME_STYLE_OPTIONS,
  THEME_STYLES,
  normalizeAppearance,
  normalizeColorScheme,
  normalizeReadingFont,
  normalizeReadingSize,
  normalizeThemeStyle,
  readingFontStack,
  resolveColorScheme,
} from "./appearance";

describe("appearance", () => {
  it("normalizes known theme styles and falls back to graphite", () => {
    expect(normalizeThemeStyle("paper")).toBe("paper");
    expect(normalizeThemeStyle("noir")).toBe("noir");
    expect(normalizeThemeStyle("graphite")).toBe("graphite");
    expect(normalizeThemeStyle("moss")).toBe("moss");
    expect(normalizeThemeStyle("tide")).toBe("tide");
    expect(normalizeThemeStyle("clay")).toBe("clay");
    expect(normalizeThemeStyle("neon")).toBe("graphite");
    expect(normalizeThemeStyle(undefined)).toBe("graphite");
  });

  it("normalizes color schemes and defaults to light", () => {
    expect(normalizeColorScheme("light")).toBe("light");
    expect(normalizeColorScheme("dark")).toBe("dark");
    expect(normalizeColorScheme("system")).toBe("system");
    expect(normalizeColorScheme("auto")).toBe("light");
  });

  it("normalizes reading fonts and sizes", () => {
    expect(normalizeReadingFont("serif")).toBe("serif");
    expect(normalizeReadingFont("wenkai")).toBe("wenkai");
    expect(normalizeReadingFont("comic")).toBe("system");
    expect(normalizeReadingSize("lg")).toBe("lg");
    expect(normalizeReadingSize("huge")).toBe("md");
  });

  it("resolves system scheme from prefers-dark", () => {
    expect(resolveColorScheme("light", true)).toBe("light");
    expect(resolveColorScheme("dark", false)).toBe("dark");
    expect(resolveColorScheme("system", true)).toBe("dark");
    expect(resolveColorScheme("system", false)).toBe("light");
  });

  it("offers light and dark paper swatches for every theme style", () => {
    expect(THEME_STYLE_OPTIONS.map((item) => item.value)).toEqual([...THEME_STYLES]);
    for (const item of THEME_STYLE_OPTIONS) {
      expect(item.light.bg).toMatch(/^#[0-9A-F]{6}$/i);
      expect(item.light.fg).toMatch(/^#[0-9A-F]{6}$/i);
      expect(item.dark.bg).toMatch(/^#[0-9A-F]{6}$/i);
      expect(item.dark.fg).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("offers a stack for every reading font and size option", () => {
    expect(READING_FONT_OPTIONS.map((item) => item.value)).toEqual([...READING_FONTS]);
    expect(READING_SIZE_OPTIONS.map((item) => item.value)).toEqual([...READING_SIZES]);
    for (const item of READING_FONT_OPTIONS) {
      expect(item.stack.length).toBeGreaterThan(10);
      expect(readingFontStack(item.value)).toBe(item.stack);
    }
  });

  it("normalizes appearance objects", () => {
    expect(
      normalizeAppearance({
        themeStyle: "paper",
        colorScheme: "dark",
        readingFont: "serif",
        readingSize: "xl",
      }),
    ).toEqual({
      themeStyle: "paper",
      colorScheme: "dark",
      readingFont: "serif",
      readingSize: "xl",
    });
    expect(normalizeAppearance(null)).toEqual({
      themeStyle: "graphite",
      colorScheme: "light",
      readingFont: "system",
      readingSize: "md",
    });
  });
});
