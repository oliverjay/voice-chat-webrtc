<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	let { children } = $props();

	onMount(() => {
		if (!browser) return;

		// Block pinch-zoom gestures globally
		document.addEventListener('touchmove', (e) => {
			if (e.touches.length > 1) e.preventDefault();
		}, { passive: false });

		// Block double-tap zoom by intercepting rapid taps
		let lastTouchEnd = 0;
		document.addEventListener('touchend', (e) => {
			const now = Date.now();
			if (now - lastTouchEnd <= 300) e.preventDefault();
			lastTouchEnd = now;
		}, { passive: false });

		// Detect and reset any zoom that slips through (e.g. iOS input focus zoom)
		function resetZoom() {
			const vv = window.visualViewport;
			if (vv && Math.abs(vv.scale - 1) > 0.01) {
				const meta = document.querySelector('meta[name="viewport"]');
				if (meta) {
					meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
				}
			}
		}

		// visualViewport resize fires when iOS zoom changes (including input focus zoom)
		window.visualViewport?.addEventListener('resize', resetZoom);

		// Also reset on input blur in case zoom happened during focus
		document.addEventListener('focusout', () => {
			setTimeout(resetZoom, 100);
		});

		return () => {
			window.visualViewport?.removeEventListener('resize', resetZoom);
		};
	});
</script>

<svelte:head>
	<title>VC</title>
	<meta name="description" content="Beautiful video calls, no fluff." />
</svelte:head>

<div class="min-h-screen bg-base text-text-primary">
	{@render children()}
</div>
