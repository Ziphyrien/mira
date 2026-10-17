<script lang="ts">
  import { invalidate } from '$app/navigation';
  import type { PageProps } from './$types';
  import type { SpaceState } from '#lib/contracts/index.js';
  import ChatApp from '#lib/app/ChatApp.svelte';
  import Onboarding from '#lib/plugins/account/Onboarding.svelte';

  let { data }: PageProps = $props();
  let space = $derived(data.space);
  let replacing = $state(false);
  let failure = $state('');

  async function reloadAccount() {
    replacing = true;
    failure = '';
    try {
      await invalidate('mira:space');
    } catch (error) {
      failure = error instanceof Error ? error.message : '无法加载账户，请重试。';
    } finally {
      replacing = false;
    }
  }

  function enterAccount(state: SpaceState) {
    space = state;
  }
</script>

<svelte:head><title>Mira</title></svelte:head>

{#if failure}
  <main class="grid min-h-dvh place-items-center p-6 text-center">
    <div>
      <p role="alert">{failure}</p>
      <button type="button" class="btn btn-sm mt-3" onclick={reloadAccount}>重试</button>
    </div>
  </main>
{:else if replacing}
  <main class="grid min-h-dvh place-items-center">
    <span class="loading loading-spinner" aria-label="加载账户"></span>
  </main>
{:else if !space.profile}
  <Onboarding onDone={enterAccount} />
{:else}
  {#key space}
    <ChatApp initial={space} onReset={() => void reloadAccount()} />
  {/key}
{/if}
