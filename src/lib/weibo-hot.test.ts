import { describe, expect, it } from "vitest";
import { normalizeWeiboHotItems } from "./weibo-hot";

const response = (band_list: unknown[]) => ({ ok: 1, data: { band_list } });
const row = (realpos = 1, word = "测试话题", num: unknown = 12345) => ({ realpos, word, num });

describe("微博热搜安全解析", () => {
  it("读取真实排名热度并只构造可信原站地址", () => {
    const items = normalizeWeiboHotItems(response([
      { ...row(3, "话题 & #内容"), url: "javascript:alert(1)", label_name: "热" },
      { ...row(1, "榜首", "500"), scheme: "https://evil.test", label_name: "<img>" },
    ]));
    expect(items.map((item) => item.rank)).toEqual([1, 3]);
    expect(items[0]).toEqual({ rank: 1, word: "榜首", heat: 500, label: "", url: "https://s.weibo.com/weibo?q=%E6%A6%9C%E9%A6%96" });
    expect(items[1].label).toBe("热");
    expect(new URL(items[1].url).searchParams.get("q")).toBe("话题 & #内容");
    expect(items.every((item) => new URL(item.url).hostname === "s.weibo.com")).toBe(true);
  });

  it("去重、跳过广告与非法文本，保留真实排名缺口", () => {
    expect(normalizeWeiboHotItems(response([
      row(1, "Topic"), row(2, "Ｔｏｐｉｃ"), row(1, "重复排名"),
      { ...row(4), is_ad: "1" }, { ...row(5), ad_type: 2 },
      { ...row(6), label_name: "广告" }, row(7, "<script>"), row(8, "控制\u0001字符"),
      { ...row(9, "有效话题"), is_ad: "0" },
    ])).map((item) => item.rank)).toEqual([1, 9]);
  });

  it("支持实际请求的 side/hotSearch realtime 数据结构", () => {
    const items = normalizeWeiboHotItems({ ok: 1, data: { realtime: [
      { rank: 0, word: "置顶", raw_hot: 999 },
      { rank: 2, word: "榜单话题", raw_hot: 12345, label_name: "新" },
    ] } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ rank: 2, word: "榜单话题", heat: 12345, label: "新" });
  });

  it("同时返回快照和实时榜时优先使用 realtime", () => {
    const items = normalizeWeiboHotItems({ ok: 1, data: {
      band_list: [{ realpos: 1, word: "旧榜话题", num: 1 }],
      realtime: [{ realpos: 1, word: "实时话题", num: 2 }],
    } });
    expect(items[0]).toMatchObject({ word: "实时话题", heat: 2 });
  });

  it("不从缺失、错误或其他字段伪造榜单", () => {
    for (const invalid of [null, [], { data: { band_list: [row()] } },
      { ok: 0, data: { band_list: [row()] } }, { ok: 1, band_list: [row()] },
      response([{ word: "无排名", num: 5 }, { realpos: 1, word: "无热度" },
        row(0), row(-1), row(1.5), row(1, "", 3), row(2, "无限", Infinity),
        row(3, "非数值", "1万"), row(4, "空数值", ""), row(5, "负数", -1)]),
    ]) expect(normalizeWeiboHotItems(invalid)).toEqual([]);
  });
});
