const pad = (n: number) => (n < 10 ? "0" + n : String(n));

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

export function dayLabel(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "日期未知";
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 · 周${weekday}`;
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "--:--" : pad(d.getHours()) + ":" + pad(d.getMinutes());
}

export function formatSync(ts: number): string {
  if (!ts) return "尚未同步";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "更新于 " + formatClock(ts);
  return "更新于 " + pad(d.getMonth() + 1) + "/" + pad(d.getDate());
}

export function formatRelativeShort(ts: number): string {
  const t = Number(ts);
  if (!t) return "";
  const diff = Date.now() - t;
  if (diff < 45 * 1000) return "刚刚";
  if (diff < 60 * 60 * 1000) return Math.max(1, Math.round(diff / 60000)) + "分钟前";
  if (diff < 24 * 60 * 60 * 1000) return Math.max(1, Math.round(diff / 3600000)) + "小时前";
  const d = new Date(t);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) return pad(d.getMonth() + 1) + "/" + pad(d.getDate());
  return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate());
}

export function formatCount(value: number): string {
  const num = Number(value) || 0;
  if (num >= 10000) return (num / 10000).toFixed(1).replace(/\.0$/, "") + "万";
  return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function shortCount(value: number): string {
  const num = Number(value) || 0;
  if (num >= 10000) return (num / 10000).toFixed(1).replace(/\.0$/, "") + "万";
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(num);
}

export function platformShort(platform: string): string {
  if (platform === "x") return "X";
  if (platform === "xueqiu") return "雪球";
  if (platform === "weibo") return "微博";
  return String(platform || "");
}
