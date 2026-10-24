<script lang="ts">
	import './layout.css';
	import '#lib/app/compat.js';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="description" content="Mira — 记得你们每一次对话的个人助理" />
</svelte:head>

{@render children()}
