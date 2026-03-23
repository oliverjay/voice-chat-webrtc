<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	let {
		stream = null,
		name = '',
		muted = false,
		mirror = false,
		showAudioLevel = false,
		size = 'lg'
	}: {
		stream?: MediaStream | null;
		name?: string;
		muted?: boolean;
		mirror?: boolean;
		showAudioLevel?: boolean;
		size?: 'sm' | 'md' | 'lg';
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

	const hasVideo = $derived(stream?.getVideoTracks().some((t) => t.enabled) ?? false);
	const isSpeaking = $derived(audioLevel > 0.05);

	const avatarClass = $derived(
		size === 'sm' ? 'h-8 w-8 text-sm' :
		size === 'md' ? 'h-12 w-12 text-lg' :
		'h-20 w-20 text-3xl'
	);
	const nameClass = $derived(
		size === 'sm' ? 'text-[11px]' : 'text-[13px]'
	);
	const borderRadius = $derived(
		size === 'sm' ? 'rounded-lg' :
		size === 'md' ? 'rounded-xl' :
		'rounded-2xl'
	);
</script>

<div
	class="bg-surface relative h-full w-full overflow-hidden {borderRadius} transition-all duration-300 {isSpeaking
		? 'ring-2 ring-green-500/50 ring-offset-1 ring-offset-base'
		: 'ring-1 ring-white/[0.06]'}"
>
	{#if stream}
		<video
			bind:this={videoEl}
			autoplay
			playsinline
			{muted}
			class="absolute inset-0 h-full w-full object-cover {mirror ? 'scale-x-[-1]' : ''}"
		></video>
		{#if !hasVideo}
			<div class="absolute inset-0 flex items-center justify-center">
				<div class="bg-white/[0.06] flex items-center justify-center rounded-full font-medium text-text-secondary {avatarClass}">
					{name ? name[0]?.toUpperCase() || '?' : '?'}
				</div>
			</div>
		{/if}
	{:else}
		<div class="absolute inset-0 flex items-center justify-center">
			<div class="bg-white/[0.06] flex items-center justify-center rounded-full font-medium text-text-secondary {avatarClass}">
				{name ? name[0]?.toUpperCase() || '?' : '?'}
			</div>
		</div>
	{/if}

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
</div>
