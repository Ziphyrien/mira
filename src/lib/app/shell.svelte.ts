export class ShellState {
  #folded = $state(false);
  #settings = $state(false);
  get folded() {
    return this.#folded;
  }
  get settings() {
    return this.#settings;
  }
  showChat = () => {
    this.#folded = false;
  };
  toggleMemory = () => {
    this.#folded = !this.#folded;
  };
  openSettings = () => {
    this.#settings = true;
  };
  closeSettings = () => {
    this.#settings = false;
  };
}
