import { Temporal } from "temporal-polyfill";

const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const zoned = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone());

/** “刚刚”, “5 分钟前”, “昨天 21:40”, “3 月 2 日” … */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return "刚刚";
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  const then = zoned(ms);
  const today = zoned(now).toPlainDate();
  const days = then.toPlainDate().until(today, { largestUnit: "day" }).days;
  const hm = then.toPlainTime().toString({ smallestUnit: "minute" });
  if (days === 0) return rtf.format(-Math.round(s / 3600), "hour");
  if (days === 1) return `昨天 ${hm}`;
  if (days < 7) return `${rtf.format(-days, "day")}`;
  return then.year === zoned(now).year
    ? `${then.month} 月 ${then.day} 日`
    : `${then.year} 年 ${then.month} 月 ${then.day} 日`;
}

/** Label for a day separator in the chat. */
export function dayLabel(ms: number, now = Date.now()): string {
  const days = zoned(ms).toPlainDate().until(zoned(now).toPlainDate(), { largestUnit: "day" }).days;
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  const d = zoned(ms);
  return d.year === zoned(now).year
    ? `${d.month} 月 ${d.day} 日`
    : `${d.year} 年 ${d.month} 月 ${d.day} 日`;
}

export function sameDay(a: number, b: number): boolean {
  return zoned(a).toPlainDate().equals(zoned(b).toPlainDate());
}
