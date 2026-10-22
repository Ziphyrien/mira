import { PRESENCE_HEARTBEAT_MS } from "#lib/contracts/research-presence.js";
import { RESEARCH_PROTOCOL } from "#lib/contracts/research-protocol.js";
/** Visibility is operational telemetry; it neither submits an answer nor ends participation. */
export function trackPresence(endpoint: string) {
  const tabId = crypto.randomUUID();
  let sequence = 0,
    stopped = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  function clear() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  function send(state: "visible" | "hidden" | "left") {
    if (stopped) return;
    void fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "X-Mira-Research-Protocol": RESEARCH_PROTOCOL,
      },
      body: JSON.stringify({
        action: "presence",
        presence: { tabId, sequence: ++sequence, state },
      }),
    })
      .then((response) => {
        if (response.status === 404 || response.status === 410) stop(false);
      })
      .catch(() => {
        /* Freshness expires if the browser cannot report. */
      });
  }
  function visible() {
    clear();
    const state = document.visibilityState === "visible" ? "visible" : "hidden";
    send(state);
    if (state === "visible" && !stopped) timer = setTimeout(visible, PRESENCE_HEARTBEAT_MS);
  }
  function leave() {
    clear();
    send("left");
  }
  function stop(report = true) {
    if (stopped) return;
    if (report) leave();
    stopped = true;
    clear();
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("pagehide", leave);
    window.removeEventListener("pageshow", visible);
    window.removeEventListener("online", visible);
  }
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("pagehide", leave);
  window.addEventListener("pageshow", visible);
  window.addEventListener("online", visible);
  visible();
  return () => stop();
}
