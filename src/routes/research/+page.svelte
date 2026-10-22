<script lang="ts">
 import Dashboard from '#lib/plugins/research/Dashboard.svelte';
 import type { PageProps } from './$types';
 let {data}:PageProps=$props();
</script>
<Dashboard authenticated={data.authenticated} initial={data.studies}/>
