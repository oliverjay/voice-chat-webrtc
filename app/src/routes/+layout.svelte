<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<svelte:head>
	<title>VC</title>
	<meta name="description" content="Beautiful video calls, no fluff." />
</svelte:head>

<div class="min-h-screen bg-base text-text-primary">
	{@render children()}
</div>
