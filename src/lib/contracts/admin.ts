import type { Stats } from "./memory.js";
import type { Row } from "./messages.js";
import type { Profile } from "./profile.js";

export type SpaceSummary = {
  id: string;
  name: string;
  created: number;
  seen: number;
  messages: number;
  cost: number;
};
export type SpaceDetail = {
  profile: Profile | null;
  stats: Stats;
  messages: Row[];
  view: string;
  cost: number;
};
