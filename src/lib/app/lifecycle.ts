/** Application lifetime only; feature state belongs to feature resources. */
export class AppLifetime {
  #controller = new AbortController();
  get signal() {
    return this.#controller.signal;
  }
  get alive() {
    return !this.signal.aborted;
  }
  dispose() {
    this.#controller.abort();
  }
}
