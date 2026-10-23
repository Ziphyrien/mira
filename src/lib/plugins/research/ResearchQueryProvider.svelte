<script lang="ts">
 import {onDestroy,type Snippet} from 'svelte';
 import {QueryClient,QueryClientProvider} from '@tanstack/svelte-query';
 let {children}:{children:Snippet}=$props();
 const client=new QueryClient({defaultOptions:{queries:{enabled:!import.meta.env.SSR,retry:false,gcTime:Infinity,staleTime:0,refetchOnWindowFocus:true,refetchOnReconnect:true}}});
 onDestroy(()=>client.clear());
</script>
<QueryClientProvider {client}>{@render children()}</QueryClientProvider>
