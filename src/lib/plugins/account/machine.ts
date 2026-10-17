import { setup } from "xstate";

export type OnboardingEvent =
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "SAVED" }
  | { type: "FAIL" }
  | { type: "EXISTING" };

/** First-run questions, one at a time; every step can go back. */
export const onboardingMachine = setup({
  types: {
    events: {} as OnboardingEvent,
  },
}).createMachine({
  id: "onboarding",
  initial: "welcome",
  states: {
    welcome: { on: { NEXT: "name", EXISTING: "restore" } },
    restore: { on: { NEXT: "restoring", BACK: "welcome" } },
    restoring: { on: { SAVED: "done", FAIL: "restore" } },
    name: { on: { NEXT: "focus", BACK: "welcome" } },
    focus: { on: { NEXT: "style", BACK: "name" } },
    style: { on: { NEXT: "saving", BACK: "focus" } },
    saving: { on: { SAVED: "done", FAIL: "style" } },
    done: { type: "final" },
  },
});
