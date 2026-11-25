/** 阅读器外观：主题风格 × 明暗 × 字体 × 整体尺寸（可跟随系统明暗） */

export const THEME_STYLES = ["graphite", "paper", "noir", "moss", "tide", "clay"] as const;
export type ThemeStyle = (typeof THEME_STYLES)[number];

export const COLOR_SCHEMES = ["light", "dark", "system"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

/**
 * 免费/系统级阅读字体。扩展 CSP 不允许拉外网字体，因此全部走本机已装字体栈；
 * 优先常见开源阅读字体（霞鹜文楷、思源、Noto），再回退到系统黑体/宋体/楷体。
 */
export const READING_FONTS = ["system", "sans", "serif", "kai", "yuan", "wenkai"] as const;
export type ReadingFont = (typeof READING_FONTS)[number];

/** 整体尺寸：正文、元信息与基础 UI 字号一起缩放 */
export const READING_SIZES = ["sm", "md", "lg", "xl"] as const;
export type ReadingSize = (typeof READING_SIZES)[number];

export type Appearance = {
  themeStyle: ThemeStyle;
  colorScheme: ColorScheme;
  readingFont: ReadingFont;
  readingSize: ReadingSize;
};

export const DEFAULT_APPEARANCE: Appearance = {
  themeStyle: "graphite",
  colorScheme: "light",
  readingFont: "system",
  readingSize: "md",
};

const MIRROR_KEY = "owlivo.appearance";

/** 本页 URL ?theme=&scheme=&font=&size= 覆盖；会话内优先生效，不写回 storage */
let sessionUrlOverride: Partial<Appearance> | null = null;

export function getSessionUrlOverride(): Partial<Appearance> | null {
  return sessionUrlOverride;
}

/** 用户在设置里改外观后清除 URL 会话覆盖 */
export function clearSessionUrlOverride(): void {
  sessionUrlOverride = null;
}

export function mergeAppearance(
  stored:
    | {
        themeStyle?: unknown;
        colorScheme?: unknown;
        readingFont?: unknown;
        readingSize?: unknown;
      }
    | null
    | undefined,
): Appearance {
  const base = normalizeAppearance(stored);
  if (!sessionUrlOverride) return base;
  return normalizeAppearance({
    themeStyle: sessionUrlOverride.themeStyle ?? base.themeStyle,
    colorScheme: sessionUrlOverride.colorScheme ?? base.colorScheme,
    readingFont: sessionUrlOverride.readingFont ?? base.readingFont,
    readingSize: sessionUrlOverride.readingSize ?? base.readingSize,
  });
}

export function isThemeStyle(value: unknown): value is ThemeStyle {
  return THEME_STYLES.includes(value as ThemeStyle);
}

export function isColorScheme(value: unknown): value is ColorScheme {
  return COLOR_SCHEMES.includes(value as ColorScheme);
}

export function isReadingFont(value: unknown): value is ReadingFont {
  return READING_FONTS.includes(value as ReadingFont);
}

export function isReadingSize(value: unknown): value is ReadingSize {
  return READING_SIZES.includes(value as ReadingSize);
}

export function normalizeThemeStyle(value: unknown): ThemeStyle {
  return isThemeStyle(value) ? value : DEFAULT_APPEARANCE.themeStyle;
}

export function normalizeColorScheme(value: unknown): ColorScheme {
  return isColorScheme(value) ? value : DEFAULT_APPEARANCE.colorScheme;
}

export function normalizeReadingFont(value: unknown): ReadingFont {
  return isReadingFont(value) ? value : DEFAULT_APPEARANCE.readingFont;
}

export function normalizeReadingSize(value: unknown): ReadingSize {
  return isReadingSize(value) ? value : DEFAULT_APPEARANCE.readingSize;
}

export function normalizeAppearance(
  input:
    | {
        themeStyle?: unknown;
        colorScheme?: unknown;
        readingFont?: unknown;
        readingSize?: unknown;
      }
    | null
    | undefined,
): Appearance {
  return {
    themeStyle: normalizeThemeStyle(input?.themeStyle),
    colorScheme: normalizeColorScheme(input?.colorScheme),
    readingFont: normalizeReadingFont(input?.readingFont),
    readingSize: normalizeReadingSize(input?.readingSize),
  };
}

export function resolveColorScheme(
  scheme: ColorScheme,
  prefersDark = matchPrefersDark(),
): "light" | "dark" {
  if (scheme === "light") return "light";
  if (scheme === "dark") return "dark";
  return prefersDark ? "dark" : "light";
}

export function matchPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function readAppearanceMirror(): Appearance | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return null;
    return normalizeAppearance(JSON.parse(raw) as Appearance);
  } catch {
    return null;
  }
}

export function writeAppearanceMirror(appearance: Appearance): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(normalizeAppearance(appearance)));
  } catch {
    // 隐私模式等写失败时忽略；chrome.storage 仍是权威源
  }
}

export function readAppearanceFromSearch(
  search = typeof location !== "undefined" ? location.search : "",
): Partial<Appearance> {
  try {
    const params = new URLSearchParams(search);
    const out: Partial<Appearance> = {};
    const theme = params.get("theme");
    const scheme = params.get("scheme");
    const font = params.get("font");
    const size = params.get("size");
    if (isThemeStyle(theme)) out.themeStyle = theme;
    if (isColorScheme(scheme)) out.colorScheme = scheme;
    if (isReadingFont(font)) out.readingFont = font;
    if (isReadingSize(size)) out.readingSize = size;
    return out;
  } catch {
    return {};
  }
}

/** 同步写到 <html>：data-theme / data-font / data-size + .dark + color-scheme + 字体栈变量 */
export function applyAppearance(
  appearance: Appearance,
  prefersDark = matchPrefersDark(),
): "light" | "dark" {
  const next = normalizeAppearance(appearance);
  const resolved = resolveColorScheme(next.colorScheme, prefersDark);
  const root = document.documentElement;
  root.dataset.theme = next.themeStyle;
  root.dataset.font = next.readingFont;
  root.dataset.size = next.readingSize;
  // 内联写入字体栈，避免仅靠 data-font 选择器时被主题层 / 继承解析拖住
  root.style.setProperty("--font-sans-stack", readingFontStack(next.readingFont));
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  writeAppearanceMirror(next);
  return resolved;
}

/**
 * 入口首帧调用：URL 覆盖 > localStorage 镜像 > 默认。
 * chrome.storage 加载后再 merge（URL 会话覆盖仍优先）。
 */
export function bootstrapAppearance(
  search = typeof location !== "undefined" ? location.search : "",
): Appearance {
  const fromUrl = readAppearanceFromSearch(search);
  sessionUrlOverride =
    fromUrl.themeStyle || fromUrl.colorScheme || fromUrl.readingFont || fromUrl.readingSize
      ? fromUrl
      : null;
  const mirrored = readAppearanceMirror();
  const appearance = mergeAppearance({
    themeStyle: mirrored?.themeStyle,
    colorScheme: mirrored?.colorScheme,
    readingFont: mirrored?.readingFont,
    readingSize: mirrored?.readingSize,
  });
  applyAppearance(appearance);
  return appearance;
}

export type ThemeSwatch = {
  bg: string;
  rail: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
};

export const THEME_STYLE_OPTIONS: Array<{
  value: ThemeStyle;
  label: string;
  hint: string;
  light: ThemeSwatch;
  dark: ThemeSwatch;
}> = [
  {
    value: "graphite",
    label: "砚灰",
    hint: "冷白清透",
    light: {
      bg: "#F8F9FB",
      rail: "#F1F3F6",
      fg: "#16191E",
      muted: "#555E6B",
      border: "#E2E6EC",
      accent: "#2457B2",
    },
    dark: {
      bg: "#14161A",
      rail: "#101215",
      fg: "#E2E5EC",
      muted: "#9098A6",
      border: "#272C35",
      accent: "#6A9CF0",
    },
  },
  {
    value: "paper",
    label: "宣纸",
    hint: "温润朱批",
    light: {
      bg: "#FCFBF5",
      rail: "#F3F0E6",
      fg: "#141312",
      muted: "#62605A",
      border: "#E5E1D4",
      accent: "#AD342B",
    },
    dark: {
      bg: "#141312",
      rail: "#100F0E",
      fg: "#DBD8CE",
      muted: "#949189",
      border: "#292724",
      accent: "#E06C60",
    },
  },
  {
    value: "noir",
    label: "水墨",
    hint: "电纸纯墨",
    light: {
      bg: "#F5F5F3",
      rail: "#ECECE9",
      fg: "#171716",
      muted: "#595956",
      border: "#DFDFDB",
      accent: "#262624",
    },
    dark: {
      bg: "#121211",
      rail: "#0D0D0C",
      fg: "#DFDFDC",
      muted: "#91918D",
      border: "#272725",
      accent: "#E5E5E0",
    },
  },
  {
    value: "moss",
    label: "青竹",
    hint: "宋瓷微青",
    light: {
      bg: "#F5F8F6",
      rail: "#ECF1EE",
      fg: "#17201C",
      muted: "#515E58",
      border: "#DCE4DF",
      accent: "#1F6E60",
    },
    dark: {
      bg: "#131816",
      rail: "#0E1311",
      fg: "#DAE2DE",
      muted: "#8C9B94",
      border: "#252F2B",
      accent: "#55B4A3",
    },
  },
  {
    value: "tide",
    label: "雾蓝",
    hint: "冷雾静读",
    light: {
      bg: "#F4F7FA",
      rail: "#EBF0F5",
      fg: "#161F29",
      muted: "#505D6B",
      border: "#DCE3EC",
      accent: "#245A87",
    },
    dark: {
      bg: "#141A21",
      rail: "#0F141A",
      fg: "#D9E1EA",
      muted: "#8D9CA9",
      border: "#26313D",
      accent: "#6BA4D4",
    },
  },
  {
    value: "clay",
    label: "暖沙",
    hint: "晚间羊皮",
    light: {
      bg: "#F6EFE2",
      rail: "#EDE4D3",
      fg: "#221B15",
      muted: "#61564B",
      border: "#E1D6C3",
      accent: "#995120",
    },
    dark: {
      bg: "#191512",
      rail: "#13100E",
      fg: "#DFD6CA",
      muted: "#9B9084",
      border: "#2E2721",
      accent: "#D89056",
    },
  },
];

export const COLOR_SCHEME_OPTIONS: Array<{ value: ColorScheme; label: string }> = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];

export const READING_FONT_OPTIONS: Array<{
  value: ReadingFont;
  label: string;
  hint: string;
  stack: string;
}> = [
  {
    value: "system",
    label: "系统",
    hint: "跟随设备",
    stack:
      '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Noto Sans SC", "Noto Sans CJK SC", system-ui, sans-serif',
  },
  {
    value: "sans",
    label: "黑体",
    hint: "清晰扫读",
    stack:
      '"PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei UI", "Microsoft YaHei", "WenQuanYi Micro Hei", system-ui, sans-serif',
  },
  {
    value: "serif",
    label: "宋体",
    hint: "长文沉浸",
    stack:
      '"Songti SC", "STSong", "Source Han Serif SC", "Noto Serif SC", "Noto Serif CJK SC", SimSun, "Song Dynasty", Georgia, "Times New Roman", serif',
  },
  {
    value: "kai",
    label: "楷体",
    hint: "书卷文气",
    stack: '"Kaiti SC", STKaiti, KaiTi, "AR PL UKai CN", "Noto Serif SC", "Songti SC", serif',
  },
  {
    value: "yuan",
    label: "圆体",
    hint: "柔和轻松",
    stack:
      '"Yuanti SC", STYuanti, "Hiragino Maru Gothic ProN", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  {
    value: "wenkai",
    label: "霞鹜文楷",
    hint: "开源手写感",
    stack:
      '"LXGW WenKai", "LXGW WenKai Lite", "LXGW WenKai Screen", "Kaiti SC", STKaiti, KaiTi, "Noto Serif SC", "Songti SC", serif',
  },
];

export const READING_SIZE_OPTIONS: Array<{
  value: ReadingSize;
  label: string;
  hint: string;
}> = [
  { value: "sm", label: "小", hint: "更紧凑" },
  { value: "md", label: "标准", hint: "默认" },
  { value: "lg", label: "大", hint: "更舒展" },
  { value: "xl", label: "特大", hint: "远距离" },
];

export function readingFontStack(font: ReadingFont): string {
  return (
    READING_FONT_OPTIONS.find((item) => item.value === font)?.stack || READING_FONT_OPTIONS[0].stack
  );
}
