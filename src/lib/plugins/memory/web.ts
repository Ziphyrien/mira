import { defineFacet, type Facet } from "@earendil-works/chord";
import { toolbarRegistry } from "#lib/app/registries.js";
import { mainRegistry } from "#lib/app/views.js";
import MemoryControl from "#lib/plugins/memory/MemoryControl.svelte";
import MemoryView from "#lib/plugins/memory/MemoryView.svelte";
import { Memory } from "#lib/plugins/memory/api.js";
import { MemoryState } from "#lib/plugins/memory/state.svelte.js";
import { Conversation } from "#lib/plugins/conversation/api.js";
export const memoryWeb: Facet = {
  name: "mira.web.memory",
  ...defineFacet(
    (api) =>
      api.serve(
        Memory,
        (_input, _principal, self) => {
          const conversation = self.get(Conversation, {});
          const memory = self.resource("memory", {
            version: 1,
            deps: [conversation],
            open: () => new MemoryState(conversation.view!),
            close: (owner) => owner.dispose(),
          });
          self.register(toolbarRegistry, { memory: { order: 30, component: MemoryControl } });
          self.register(mainRegistry, { memory: { order: 10, component: MemoryView } });
          return { view: self.expose(memory) };
        },
        { lifetime: "host" },
      ),
    { uses: [Conversation] },
  ),
};
