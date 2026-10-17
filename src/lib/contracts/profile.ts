import { z } from "zod";

export const FOCUS = [
  {
    id: "work",
    label: "工作与写作",
    icon: "icon-[lucide--briefcase]",
    prompts: ["帮我把这段话改得更清楚", "给下周的工作列个计划"],
  },
  {
    id: "study",
    label: "学习新东西",
    icon: "icon-[lucide--graduation-cap]",
    prompts: ["用简单的话讲讲量子纠缠", "帮我制定一个学习计划"],
  },
  {
    id: "code",
    label: "编程",
    icon: "icon-[lucide--code]",
    prompts: ["帮我看看这段代码哪里有问题", "解释一下 TypeScript 泛型"],
  },
  {
    id: "life",
    label: "生活安排",
    icon: "icon-[lucide--calendar]",
    prompts: ["帮我安排一个轻松的周末", "推荐几道简单的晚饭"],
  },
  {
    id: "ideas",
    label: "想法与创作",
    icon: "icon-[lucide--lightbulb]",
    prompts: ["陪我头脑风暴一个副业点子", "帮我给新项目起个名字"],
  },
  {
    id: "talk",
    label: "随便聊聊",
    icon: "icon-[lucide--message-circle]",
    prompts: ["今天有点累，想聊聊", "最近有什么值得看的书"],
  },
] as const;

export const STYLES = [
  { id: "brief", label: "简洁", hint: "直接给结论" },
  { id: "balanced", label: "适中", hint: "结论加上必要的解释" },
  { id: "detailed", label: "详细", hint: "把来龙去脉讲清楚" },
] as const;

const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const ProfileInput = z.object({
  name: z.string().trim().min(1).max(40),
  focus: z.array(z.enum(["work", "study", "code", "life", "ideas", "talk"])).max(6),
  style: z.enum(["brief", "balanced", "detailed"]),
  timezone: z.string().max(64).refine(validZone),
});
export type Profile = z.infer<typeof ProfileInput>;
