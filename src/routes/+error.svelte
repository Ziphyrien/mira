<script lang="ts">
  import type { ErrorProps } from './$types';

  let { error }: ErrorProps = $props();
</script>

<svelte:head><title>{error.status} · Mira</title></svelte:head>

<main class="grid min-h-dvh place-items-center p-6 text-center">
  <div class="max-w-md space-y-4">
    <h1 class="text-2xl font-semibold">{error.status === 404 ? '没有找到这个页面' : '暂时无法打开页面'}</h1>
    <p class="text-base-content/65" role="alert">{error.message}</p>
    <div class="flex justify-center gap-3">
      <a class="btn btn-primary" href="/">返回首页</a>
      <button type="button" class="btn btn-ghost" onclick={() => window.location.reload()}>重试</button>
    </div>
  </div>
</main>
