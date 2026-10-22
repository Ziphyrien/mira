// Transport freshness is separate from a study's response/return observation window.
export const PRESENCE_HEARTBEAT_MS = 20_000;
export const PRESENCE_FRESH_FOR_MS = 60_000;
export type PagePresenceState = "foreground" | "background" | "left" | "unknown";
export type PagePresence = {
  state: PagePresenceState;
  observedAt: number;
  lastSeenAt: number | null;
  freshUntil: number | null;
};
