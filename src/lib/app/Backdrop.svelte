<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import light from "#lib/assets/scene-light.jpg?enhanced";
  import dark from "#lib/assets/scene-dark.jpg?enhanced";

  let { class: className = "" }: { class?: string } = $props();
  const prefersDark = new MediaQuery("prefers-color-scheme: dark");
</script>

<div
  class={["pointer-events-none absolute inset-0 overflow-hidden", className]}
  aria-hidden="true"
>
  <enhanced:img
    src={prefersDark.current ? dark : light}
    alt=""
    sizes="100vw"
    class="h-full w-full object-cover"
  />
  <div
    class="from-base-100/30 via-base-100/60 to-base-100 absolute inset-0 bg-gradient-to-b"
  ></div>
</div>
