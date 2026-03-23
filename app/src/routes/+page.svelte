<script lang="ts">
	import { goto } from '$app/navigation';
	import { generateRoomId } from '$lib/utils/room-id';

	let toast = $state('');

	async function startCall() {
		const roomId = generateRoomId();
		const url = `${window.location.origin}/${roomId}`;

		try {
			await navigator.clipboard.writeText(url);
			toast = 'Invite link copied to clipboard';
		} catch {
			toast = '';
		}

		setTimeout(() => goto(`/${roomId}`), 600);
	}

	$effect(() => {
		if (toast) {
			const t = setTimeout(() => (toast = ''), 3000);
			return () => clearTimeout(t);
		}
	});
</script>

<div class="flex min-h-dvh flex-col items-center justify-center px-4">
	<div class="w-full max-w-sm space-y-10 text-center">
		<div class="space-y-2">
			<h1 class="text-4xl font-bold tracking-tight">VC</h1>
			<p class="text-text-secondary text-[15px]">Video calls, without the fluff.</p>
		</div>

		<button
			onclick={startCall}
			class="shiny-cta w-full px-8 py-3.5 text-base font-semibold"
		>
			<span>Start a call</span>
		</button>

		<p class="text-text-muted text-[13px]">
			No accounts. No downloads. Just share the link.
		</p>
	</div>

	{#if toast}
		<div class="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 animate-fade-in">
			<div class="rounded-full border border-white/[0.08] bg-surface/95 px-5 py-2.5 text-[13px] text-text-primary shadow-xl backdrop-blur-xl">
				{toast}
			</div>
		</div>
	{/if}
</div>

<style>
	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}
	:global(.animate-fade-in) {
		animation: fadeIn 0.2s ease-out;
	}
</style>
