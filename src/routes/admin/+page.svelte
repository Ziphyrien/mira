<script lang="ts">
  import { onMount } from 'svelte';
  import type { PageProps } from './$types';
  import { createAdminAppHost, type AdminAppHost } from '#lib/app/admin-host.js';
  import AdminShell from '#lib/plugins/admin/AdminShell.svelte';

  let { data }: PageProps = $props();
  let adminHost = $state.raw<AdminAppHost>();
  let failure = $state('');

  onMount(() => {
    let disposed = false;
    let created: AdminAppHost | undefined;

    void createAdminAppHost({ initial: { admin: data.authenticated } })
      .then(async (host) => {
        if (disposed) {
          await host.dispose();
          return;
        }
        created = host;
        adminHost = host;
        await host.admin.initialize(null);
      })
      .catch((error: unknown) => {
        if (!disposed) failure = error instanceof Error ? error.message : '无法打开管理后台。';
      });

    return () => {
      disposed = true;
      if (created) {
        void created.dispose().catch((error: unknown) => console.error('admin.close', error));
      }
    };
  });
</script>

<svelte:head><title>Mira · 管理</title></svelte:head>

{#if failure}
  <main class="grid min-h-dvh place-items-center p-6 text-center">
    <p role="alert" class="text-error">{failure}</p>
  </main>
{:else if adminHost}
  <AdminShell host={adminHost} />
{:else}
  <main class="grid min-h-dvh place-items-center">
    <span class="loading loading-spinner" aria-label="加载管理后台"></span>
  </main>
{/if}
