<script lang="ts">
	import type { Snippet } from 'svelte';
	let { count = 1, children }: { count?: number; children: Snippet } = $props();

	const gridClass = $derived(
		count <= 1
			? 'grid-cols-1'
			: count === 2
				? 'grid-cols-1 md:grid-cols-2'
				: count <= 4
					? 'grid-cols-2'
					: count <= 6
						? 'grid-cols-2 md:grid-cols-3'
						: 'grid-cols-3 md:grid-cols-4'
	);
</script>

<div class="grid h-full w-full gap-3 p-3 {gridClass} auto-rows-fr place-items-stretch">
	{@render children()}
</div>
