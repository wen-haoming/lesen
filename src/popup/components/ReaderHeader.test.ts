import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialReaderMode, ReaderHeader } from "./ReaderHeader";

afterEach(() => vi.unstubAllGlobals());

describe("reader mode header", () => {
  it("defaults to subscriptions and accepts the square preview route", () => {
    vi.stubGlobal("location", { search: "" });
    expect(initialReaderMode()).toBe("subscriptions");
    vi.stubGlobal("location", { search: "?demo=timeline&view=square" });
    expect(initialReaderMode()).toBe("square");
    vi.stubGlobal("location", { search: "?view=unknown" });
    expect(initialReaderMode()).toBe("subscriptions");
  });

  it("shows both modes and compact header actions", () => {
    const html = renderToStaticMarkup(
      createElement(ReaderHeader, {
        mode: "square",
        onModeChange: vi.fn(),
        onOpenSettings: vi.fn(),
        onOpenAccount: vi.fn(),
        onOpenHome: vi.fn(),
      }),
    );
    expect(html).toContain("阅读模式");
    expect(html).toContain("订阅");
    expect(html).toContain("广场");
    expect(html.match(/aria-label="打开设置"/g)).toHaveLength(1);
    expect(html.match(/aria-label="更多操作"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-label="账号登录"');
    expect(html).not.toContain('aria-label="打开首页"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).not.toContain("刷新订阅");
  });

  it("places view actions (search, refresh) before system actions (settings, more)", () => {
    const html = renderToStaticMarkup(
      createElement(ReaderHeader, {
        mode: "subscriptions",
        onModeChange: vi.fn(),
        onOpenSettings: vi.fn(),
        onOpenAccount: vi.fn(),
        onOpenHome: vi.fn(),
        onToggleSearch: vi.fn(),
        onRefresh: vi.fn(),
        onSwitchSurface: vi.fn(),
        shellMode: "sidebar",
        refreshing: true,
      }),
    );
    const searchIdx = html.indexOf('aria-label="搜索帖子"');
    const refreshIdx = html.indexOf('aria-label="刷新订阅"');
    const settingsIdx = html.indexOf('aria-label="打开设置"');
    const moreIdx = html.indexOf('aria-label="更多操作"');
    expect(searchIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(searchIdx);
    expect(settingsIdx).toBeGreaterThan(refreshIdx);
    expect(moreIdx).toBeGreaterThan(settingsIdx);
    expect(html).toContain("disabled");

    const squareHtml = renderToStaticMarkup(
      createElement(ReaderHeader, {
        mode: "square",
        onModeChange: vi.fn(),
        onOpenSettings: vi.fn(),
        onOpenAccount: vi.fn(),
        onOpenHome: vi.fn(),
        onRefresh: vi.fn(),
      }),
    );
    expect(squareHtml).toContain("刷新广场");
  });

  it("reflects signed-in account state on the more menu trigger", () => {
    const html = renderToStaticMarkup(
      createElement(ReaderHeader, {
        mode: "subscriptions",
        onModeChange: vi.fn(),
        onOpenSettings: vi.fn(),
        onOpenAccount: vi.fn(),
        account: {
          id: "u1",
          email: "reader@example.com",
          nickname: "温浩明",
          avatarUrl: null,
        },
      }),
    );
    expect(html).toContain("更多操作（已登录：温浩明）");
  });
});
