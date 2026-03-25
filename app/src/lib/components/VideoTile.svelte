<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	let {
		stream = null,
		name = '',
		muted = false,
		mirror = false,
		showAudioLevel = false,
		size = 'lg',
		contain = false,
		circular = false,
		videoOff = false,
		isAgent = false,
		avatarUrl = '',
		agentState = 'idle'
	}: {
		stream?: MediaStream | null;
		name?: string;
		muted?: boolean;
		mirror?: boolean;
		showAudioLevel?: boolean;
		size?: 'sm' | 'md' | 'lg';
		contain?: boolean;
		circular?: boolean;
		videoOff?: boolean;
		isAgent?: boolean;
		avatarUrl?: string;
		agentState?: 'idle' | 'thinking' | 'speaking';
	} = $props();

	let videoEl = $state<HTMLVideoElement | null>(null);
	let audioLevel = $state(0);
	let audioCtx: AudioContext | null = null;
	let analyser: AnalyserNode | null = null;
	let rafId: number | null = null;

	$effect(() => {
		if (!browser) return;
		if (videoEl && stream) {
			if (videoEl.srcObject !== stream) {
				videoEl.srcObject = stream;
			}
			const wasMuted = videoEl.muted;
			videoEl.muted = true;
			videoEl.play().then(() => {
				if (videoEl) videoEl.muted = wasMuted;
			}).catch((e) => {
				console.log('[VideoTile] autoplay blocked, will retry on interaction:', e.message);
				if (videoEl) videoEl.muted = wasMuted;
				const resume = () => {
					videoEl?.play().catch(() => {});
					document.removeEventListener('click', resume);
					document.removeEventListener('keydown', resume);
				};
				document.addEventListener('click', resume, { once: true });
				document.addEventListener('keydown', resume, { once: true });
			});
		} else if (videoEl && !stream) {
			videoEl.srcObject = null;
		}
	});

	$effect(() => {
		if (!browser) return;
		cleanupAudio();

		if (showAudioLevel && stream && stream.getAudioTracks().length > 0) {
			try {
				audioCtx = new AudioContext();
				analyser = audioCtx.createAnalyser();
				analyser.fftSize = 1024;
				analyser.smoothingTimeConstant = 0.5;
				const source = audioCtx.createMediaStreamSource(stream);
				source.connect(analyser);
				const data = new Float32Array(analyser.fftSize);

				function poll() {
					if (!analyser) return;
					analyser.getFloatTimeDomainData(data);
					let sum = 0;
					for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
					const rms = Math.sqrt(sum / data.length);
					audioLevel = Math.min(1, rms / 0.15);
					rafId = requestAnimationFrame(poll);
				}
				poll();
			} catch (e) {
				console.warn('[VideoTile] Audio level setup failed:', e);
			}
		}
	});

	function cleanupAudio() {
		if (rafId !== null) cancelAnimationFrame(rafId);
		rafId = null;
		analyser = null;
		if (audioCtx) {
			audioCtx.close().catch(() => {});
			audioCtx = null;
		}
		audioLevel = 0;
	}

	onDestroy(() => cleanupAudio());

	const hasVideo = $derived(!videoOff && (stream?.getVideoTracks().length ?? 0) > 0);
	const isSpeaking = $derived(audioLevel > 0.05);

	const initials = $derived(() => {
		if (!name) return '?';
		const parts = name.replace(/\(.*\)/, '').trim().split(/\s+/);
		if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
		return parts[0][0]?.toUpperCase() || '?';
	});

	const avatarSize = $derived(
		size === 'sm' ? 'h-10 w-10 text-sm' :
		size === 'md' ? 'h-16 w-16 text-xl' :
		'h-24 w-24 text-4xl'
	);
	const photoSize = $derived(
		size === 'sm' ? 'h-12 w-12' :
		size === 'md' ? 'h-20 w-20' :
		'h-32 w-32'
	);
	const nameClass = $derived(
		size === 'sm' ? 'text-[11px]' : 'text-[13px]'
	);
	const borderRadius = $derived(
		size === 'sm' ? 'rounded-lg' :
		size === 'md' ? 'rounded-xl' :
		'rounded-2xl'
	);

	const avatarHue = $derived(() => {
		let hash = 0;
		const src = name || '?';
		for (let i = 0; i < src.length; i++) hash = src.charCodeAt(i) + ((hash << 5) - hash);
		return ((hash % 360) + 360) % 360;
	});

	const agentRingClass = $derived(
		agentState === 'speaking'
			? 'ring-2 ring-accent/70 animate-agent-speaking'
			: agentState === 'thinking'
				? 'ring-2 ring-accent/50'
				: 'ring-1 ring-accent/20 animate-agent-breathe'
	);

	const badgeSize = $derived(
		size === 'sm' ? 'text-[8px] px-1 py-0' :
		size === 'md' ? 'text-[9px] px-1.5 py-0.5' :
		'text-[10px] px-2 py-0.5'
	);
</script>

<div
	class="bg-surface relative h-full w-full overflow-hidden transition-all duration-300
		{circular ? 'rounded-full' : borderRadius}
		{isSpeaking
			? circular ? 'ring-2 ring-green-500/60' : 'ring-2 ring-green-500/50 ring-offset-1 ring-offset-base'
			: circular ? 'ring-2 ring-white/[0.12]' : 'ring-1 ring-white/[0.06]'}"
>
	{#if stream}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={videoEl}
			autoplay
			playsinline
			{muted}
			data-local={muted ? '' : undefined}
			class="absolute inset-0 h-full w-full {contain ? 'object-contain' : 'object-cover'} {mirror ? 'scale-x-[-1]' : ''}"
			class:hidden={!hasVideo}
		></video>
	{/if}
	{#if !hasVideo}
		{@render avatar()}
	{/if}

	{#if isAgent}
		{@render aiBadge()}
	{/if}

	{#if !circular && !hasVideo}
		<div
			class="pointer-events-none absolute inset-0"
			style="background: radial-gradient(circle at center 40%, hsla({avatarHue()}, 40%, 25%, 0.3) 0%, transparent 70%)"
		></div>
	{/if}

	{#if !circular}
		<div class="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent {size === 'sm' ? 'px-2 pb-1.5 pt-5' : 'px-3 pb-2 pt-8'}">
			<div class="flex items-center gap-1.5">
				{#if showAudioLevel}
					<div class="flex h-3.5 items-end gap-[2px]">
						{#each Array(4) as _, i}
							<div
								class="w-[2.5px] rounded-full transition-all duration-100 {audioLevel > i * 0.25 ? 'bg-green-400' : 'bg-white/15'}"
								style="height: {2 + i * 2}px"
							></div>
						{/each}
					</div>
				{/if}
				{#if name}
					<span class="{nameClass} font-medium text-white/80 truncate">{name}</span>
				{/if}
			</div>
		</div>
	{/if}
</div>

{#snippet avatar()}
	<div class="absolute inset-0 flex items-center justify-center">
		{#if isAgent && avatarUrl}
			<div class="relative {photoSize} rounded-full overflow-hidden ring-2 {agentState === 'speaking' ? 'ring-accent/70' : agentState === 'thinking' ? 'ring-accent/40' : 'ring-white/[0.1]'} transition-all duration-300">
				<img
					src={avatarUrl}
					alt={name}
					class="h-full w-full object-cover"
				/>
				{#if agentState === 'thinking'}
					<div class="absolute inset-0 rounded-full overflow-hidden">
						<div class="absolute -inset-1 animate-agent-thinking"></div>
					</div>
				{/if}
			</div>
		{:else}
			<div
				class="flex items-center justify-center rounded-full font-semibold tracking-wide {avatarSize}"
				style="background: hsla({avatarHue()}, 35%, 30%, 0.6); color: hsla({avatarHue()}, 50%, 80%, 0.9)"
			>
				{initials()}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet aiBadge()}
	<div class="absolute {size === 'sm' ? 'top-1 right-1' : 'top-2 right-2'} z-10 pointer-events-none">
		<div class="rounded-full bg-white/[0.08] backdrop-blur-md border border-white/[0.1] {badgeSize} font-semibold text-accent-subtle tracking-wider uppercase">
			AI
		</div>
	</div>
{/snippet}
