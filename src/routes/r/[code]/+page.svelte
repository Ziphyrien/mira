<script lang="ts">
 import Interview from '#lib/plugins/research/Interview.svelte';
 import type { PageProps } from './$types';
 let {data}:PageProps=$props();
</script>
{#key data.study.id}<Interview study={data.study} initial={data.interview}/>{/key}
