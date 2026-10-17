import { createActor } from "xstate";
import { describe, expect, it } from "vite-plus/test";
import { onboardingMachine } from "#lib/plugins/account/machine.js";

describe("onboardingMachine", () => {
  it("allows retry after failed key verification and completes without profile questions", () => {
    const actor = createActor(onboardingMachine).start();
    actor.send({ type: "EXISTING" });
    expect(actor.getSnapshot().matches("restore")).toBe(true);
    actor.send({ type: "NEXT" });
    expect(actor.getSnapshot().matches("restoring")).toBe(true);
    actor.send({ type: "BACK" });
    expect(actor.getSnapshot().matches("restoring")).toBe(true);
    actor.send({ type: "FAIL" });
    expect(actor.getSnapshot().matches("restore")).toBe(true);
    actor.send({ type: "NEXT" });
    actor.send({ type: "SAVED" });
    expect(actor.getSnapshot().status).toBe("done");
    actor.stop();
  });

  it("returns to the original first-run questions when the person chooses to start instead", () => {
    const actor = createActor(onboardingMachine).start();
    actor.send({ type: "EXISTING" });
    actor.send({ type: "BACK" });
    expect(actor.getSnapshot().matches("welcome")).toBe(true);
    actor.send({ type: "NEXT" });
    expect(actor.getSnapshot().matches("name")).toBe(true);
    actor.send({ type: "NEXT" });
    expect(actor.getSnapshot().matches("focus")).toBe(true);
    actor.send({ type: "NEXT" });
    expect(actor.getSnapshot().matches("style")).toBe(true);
    actor.send({ type: "NEXT" });
    expect(actor.getSnapshot().matches("saving")).toBe(true);
    actor.send({ type: "FAIL" });
    expect(actor.getSnapshot().matches("style")).toBe(true);
    actor.send({ type: "NEXT" });
    actor.send({ type: "SAVED" });
    expect(actor.getSnapshot().status).toBe("done");
    actor.stop();
  });
});
