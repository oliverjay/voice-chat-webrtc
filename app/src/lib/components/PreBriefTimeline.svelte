<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { PreBriefClip, ClipViewStatus } from '$lib/room/protocol';

	interface Props {
		clips: PreBriefClip[];
		viewStatuses: ClipViewStatus[];
		clientId: string;
		onWatchProgress: (clipId: string, progress: number) => void;
		onDelete?: (clipId: string) => void;
		isAuthor?: (authorId: string) => boolean;
	}

	let {
		clips,
		viewStatuses,
		clientId,
		onWatchProgress,
		onDelete,
		isAuthor
	}: Props = $props();

	let activeClipId = $state<string | null>(null);
	let videoEl: HTMLVideoElement;
	let progressInterval: ReturnType<typeof setInterval> | null = null;

	const sortedClips = $derived(
		[...clips].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
	);

	function myViewFor(clipId: string): ClipViewStatus | undefined {
		return viewStatuses.find(v => v.clipId === clipId && v.clientId === clientId);
	}

	function allViewsFor(clipId: string): ClipViewStatus[] {
		return viewStatuses.filter(v => v.clipId === clipId);
	}

	const totalClips = $derived(clips.length);
	const watchedCount = $derived(
		clips.filter(c => {
			const v = myViewFor(c.id);
			return v?.watched;
		}).length
	);
	const allWatched = $derived(totalClips > 0 && watchedCount === totalClips);

	function playClip(clip: PreBriefClip) {
		activeClipId = clip.id;
	}

	function closePlayer() {
		if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
		activeClipId = null;
	}

	function handleVideoPlay() {
		if (!activeClipId || !videoEl) return;
		if (progressInterval) clearInterval(progressInterval);
		progressInterval = setInterval(() => {
			if (!videoEl || !activeClipId) return;
			const progress = videoEl.duration ? videoEl.currentTime / videoEl.duration : 0;
			onWatchProgress(activeClipId, progress);
		}, 2000);
	}

	function handleVideoEnded() {
		if (activeClipId) {
			onWatchProgress(activeClipId, 1);
		}
		if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }

		const currentIdx = sortedClips.findIndex(c => c.id === activeClipId);
		if (currentIdx >= 0 && currentIdx < sortedClips.length - 1) {
			activeClipId = sortedClips[currentIdx + 1].id;
		} else {
			closePlayer();
		}
	}

	function handleVideoPause() {
		if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
		if (!videoEl || !activeClipId) return;
		const progress = videoEl.duration ? videoEl.currentTime / videoEl.duration : 0;
		onWatchProgress(activeClipId, progress);
	}

	onDestroy(() => {
		if (progressInterval) clearInterval(progressInterval);
	});

	function formatDuration(s: number) {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	function formatTimeAgo(iso: string) {
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		return `${Math.floor(hrs / 24)}d ago`;
	}

	const activeClip = $derived(sortedClips.find(c => c.id === activeClipId));
	const activeClipIdx = $derived(sortedClips.findIndex(c => c.id === activeClipId));
	const nextClip = $derived(activeClipIdx >= 0 && activeClipIdx + 1 < sortedClips.length ? sortedClips[activeClipIdx + 1] : null);
</script>

{#if sortedClips.length === 0}
	<!-- Empty state handled by parent -->
{:else}
	<div class="flex flex-col gap-3">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent"><polygon points="6 3 20 12 6 21 6 3"/></svg>
				<span class="text-[13px] font-semibold text-text-primary">Pre-brief clips</span>
				<span class="text-[12px] text-text-muted">({watchedCount}/{totalClips} watched)</span>
			</div>
			{#if allWatched}
				<div class="flex items-center gap-1.5 text-[12px] text-green-400">
					<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
					All caught up
				</div>
			{/if}
		</div>

		<!-- Progress bar -->
		{#if totalClips > 0}
			<div class="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
				<div
					class="h-full rounded-full bg-accent transition-all duration-500 ease-out"
					style="width: {(watchedCount / totalClips) * 100}%"
				></div>
			</div>
		{/if}

		<!-- Clip list -->
		<div class="flex flex-col gap-2">
			{#each sortedClips as clip, i (clip.id)}
				{@const view = myViewFor(clip.id)}
				{@const watched = view?.watched ?? false}
				{@const progress = view?.progress ?? 0}
				{@const viewers = allViewsFor(clip.id)}
				{@const isPlaying = activeClipId === clip.id}

				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					onclick={() => playClip(clip)}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playClip(clip); } }}
					role="button"
					tabindex="0"
					class="group relative flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-200 active:scale-[0.99]
						{isPlaying ? 'border-accent/40 bg-accent/10' : watched ? 'border-white/[0.06] bg-white/[0.02]' : 'border-white/[0.08] bg-white/[0.04] hover:border-accent/30 hover:bg-accent/5'}"
				>
					<!-- Sequence number / check -->
					<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {watched ? 'bg-green-500/15 text-green-400' : 'bg-white/[0.06] text-text-muted group-hover:text-accent group-hover:bg-accent/10'}">
						{#if watched}
							<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
						{:else if isPlaying}
							<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent"><polygon points="6 3 20 12 6 21 6 3"/></svg>
						{:else}
							<span class="text-[12px] font-semibold">{i + 1}</span>
						{/if}
					</div>

					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="text-[13px] font-medium text-text-primary truncate {watched ? 'text-text-secondary' : ''}">{clip.title}</span>
							<span class="text-[11px] text-text-muted whitespace-nowrap">{formatDuration(clip.duration)}</span>
						</div>
						<div class="flex items-center gap-2 mt-0.5">
							<span class="text-[11px] text-text-muted">{clip.authorName}</span>
							<span class="text-[11px] text-text-muted">·</span>
							<span class="text-[11px] text-text-muted">{formatTimeAgo(clip.createdAt)}</span>
						</div>

						<!-- Progress bar for partially watched -->
						{#if !watched && progress > 0}
							<div class="mt-1.5 h-0.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
								<div class="h-full rounded-full bg-accent/50" style="width: {progress * 100}%"></div>
							</div>
						{/if}

						<!-- View status dots -->
						{#if viewers.length > 0}
							<div class="flex items-center gap-1 mt-1.5">
								{#each viewers as v}
									<div
										class="h-1.5 w-1.5 rounded-full {v.watched ? 'bg-green-400' : 'bg-white/20'}"
										title="{v.participantName}: {v.watched ? 'watched' : `${Math.round(v.progress * 100)}%`}"
									></div>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Delete button for author -->
					{#if isAuthor?.(clip.authorId) && onDelete}
						<button
							onclick={(e) => { e.stopPropagation(); onDelete?.(clip.id); }}
							class="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-text-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-danger/10 hover:text-danger"
							title="Delete clip"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
						</button>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}

<!-- Video Player Overlay -->
{#if activeClip}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" role="dialog">
		<div class="relative w-full max-w-2xl flex flex-col gap-3">
			<!-- Close button -->
			<div class="flex items-center justify-between">
				<div>
					<h3 class="text-[14px] font-semibold text-text-primary">{activeClip.title}</h3>
					<p class="text-[12px] text-text-muted">{activeClip.authorName} · {formatDuration(activeClip.duration)}</p>
				</div>
				<button
					onclick={closePlayer}
					class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
				</button>
			</div>

			<div class="bg-surface relative aspect-video w-full overflow-hidden rounded-2xl border border-white/5 shadow-2xl">
				<video
					bind:this={videoEl}
					src={activeClip.mediaUrl}
					autoplay
					playsinline
					controls
					onplay={handleVideoPlay}
					onpause={handleVideoPause}
					onended={handleVideoEnded}
					class="h-full w-full object-contain"
				></video>
			</div>

			<!-- Auto-advance hint -->
			{#if nextClip}
				<p class="text-center text-[11px] text-text-muted">
					Up next: {nextClip.title}
				</p>
			{/if}
		</div>
	</div>
{/if}
