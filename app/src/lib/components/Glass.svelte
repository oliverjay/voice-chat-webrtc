<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children, class: className = '' }: { children: Snippet; class?: string } = $props();
</script>

<div class="glass rounded-2xl {className}">
	{@render children()}
</div>
