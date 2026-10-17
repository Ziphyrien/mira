import type { Profile } from "../../../src/lib/contracts";
import { STYLES, FOCUS } from "../../../src/lib/contracts";

function focusLabels(focus: Profile["focus"]): string {
  return (
    focus.map((id) => FOCUS.find((item) => item.id === id)?.label ?? id).join("、") || "未填写"
  );
}

export function profileDescription(profile: Profile): string {
  const style = STYLES.find((item) => item.id === profile.style);
  const about = [
    `称呼：${profile.name}`,
    `关注：${focusLabels(profile.focus)}`,
    `回答风格：${style?.label}（${style?.hint}）`,
    `时区：${profile.timezone}`,
  ].join("\n");
  return `<about-user>\n默认用中文回答；跟随对方当前使用的语言。你是 Mira，一个会记住对话的 AI 助理。\n${about}\n</about-user>`;
}

export function profileNote(p: Profile, previous: Profile | null): string | undefined {
  const changes: string[] = [];
  if (!previous || p.name !== previous.name) changes.push(`称呼 ${p.name}`);
  if (!previous || p.focus.join(",") !== previous.focus.join(","))
    changes.push(`关注 ${focusLabels(p.focus)}`);
  if (!previous || p.style !== previous.style)
    changes.push(`回答风格 ${STYLES.find((s) => s.id === p.style)?.label}`);
  if (!previous || p.timezone !== previous.timezone) changes.push(`时区 ${p.timezone}`);
  return changes.length ? `用户${previous ? "更新" : ""}资料：${changes.join("；")}` : undefined;
}
