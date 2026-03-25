<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { media } from '$lib/stores/media.svelte';
	import { room } from '$lib/stores/room.svelte';
	import { loadPreferences, getClientId } from '$lib/utils/preferences';
	import { generateRandomName } from '$lib/utils/names';
	import type { PreBriefClip } from '$lib/room/protocol';

	const roomId = $derived($page.params.room ?? '');
	let userName = $state('Anonymous');
	const clientId = browser ? getClientId() : '';

	if (browser) {
		userName = loadPreferences().name || generateRandomName();
	}

	function getRoomServerUrl() {
		if (!browser) return 'ws://localhost:8787';
		const env = import.meta.env.VITE_ROOM_SERVER_URL;
		if (env) return env;
		const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
		return `${proto}://${window.location.host}/ws-room`;
	}

	let videoEl: HTMLVideoElement;
	let previewEl: HTMLVideoElement;
	let title = $state('');
	let recording = $state(false);
	let recorded = $state(false);
	let uploading = $state(false);
	let uploaded = $state(false);
	let recordedBlob: Blob | null = null;
	let recordedUrl = $state('');
	let recorder: MediaRecorder | null = null;
	let chunks: Blob[] = [];
	let elapsed = $state(0);
	let recordStartTime = 0;
	let timerInterval: ReturnType<typeof setInterval> | null = null;

	const hasVideo = $derived(media.videoEnabled && media.stream?.getVideoTracks().some(t => t.enabled));
	const mediaType = $derived<'video' | 'audio'>(hasVideo ? 'video' : 'audio');

	const MAX_DURATION = 120;
	const WARN_DURATION = 100;

	onMount(async () => {
		const prefs = loadPreferences();
		userName = prefs.name || generateRandomName();
		await media.init();
		if (media.stream && videoEl) {
			videoEl.srcObject = media.stream;
		}
	});

	onDestroy(() => {
		stopRecording();
		room.disconnect();
		if (recordedUrl) URL.revokeObjectURL(recordedUrl);
	});

	$effect(() => {
		if (videoEl && media.stream) {
			videoEl.srcObject = media.stream;
		}
	});

	function startRecording() {
		if (!media.stream) return;

		chunks = [];
		elapsed = 0;
		recordStartTime = Date.now();
		recorded = false;
		uploaded = false;
		recordedBlob = null;
		if (recordedUrl) { URL.revokeObjectURL(recordedUrl); recordedUrl = ''; }

		const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
			? 'video/webm;codecs=vp9,opus'
			: MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
				? 'video/webm;codecs=vp8,opus'
				: 'video/webm';

		recorder = new MediaRecorder(media.stream, { mimeType });

		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) chunks.push(e.data);
		};

		recorder.onstop = () => {
			elapsed = Math.round((Date.now() - recordStartTime) / 1000);
			recordedBlob = new Blob(chunks, { type: recorder?.mimeType || 'video/webm' });
			recordedUrl = URL.createObjectURL(recordedBlob);
			recording = false;
			recorded = true;
		};

		recorder.start(100);
		recording = true;

		timerInterval = setInterval(() => {
			elapsed = Math.round((Date.now() - recordStartTime) / 1000);
			if (elapsed >= MAX_DURATION) {
				stopRecording();
			}
		}, 250);
	}

	function stopRecording() {
		if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
		if (recorder && recorder.state !== 'inactive') {
			recorder.stop();
		}
	}

	function discardRecording() {
		if (recordedUrl) URL.revokeObjectURL(recordedUrl);
		recordedUrl = '';
		recordedBlob = null;
		recorded = false;
		elapsed = 0;
		chunks = [];
	}

	function waitForSnapshot(): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => { unsub(); reject(new Error('Timed out waiting for room connection')); }, 5000);
			const unsub = room.onMessage((msg) => {
				if (msg.type === 'snapshot') {
					clearTimeout(timeout);
					unsub();
					resolve();
				}
			});
		});
	}

	async function uploadClip() {
		if (!recordedBlob || !roomId || uploading) return;
		uploading = true;

		try {
			const clipId = crypto.randomUUID();
			const roomServerBase = getRoomServerUrl().replace(/^ws/, 'http');
			const uploadUrl = `${roomServerBase}/clips/${roomId}/upload?clipId=${clipId}`;

			console.log('[Record] Uploading clip to', uploadUrl, 'size:', recordedBlob.size);

			const res = await fetch(uploadUrl, {
				method: 'PUT',
				headers: { 'Content-Type': recordedBlob.type },
				body: recordedBlob
			});

			if (!res.ok) throw new Error(`Upload failed: ${res.status}`);

			const mediaUrl = `${roomServerBase}/clips/${roomId}/${clipId}`;

			const clip: PreBriefClip = {
				id: clipId,
				roomId,
				authorId: clientId,
				authorName: userName,
				title: title.trim() || 'Untitled clip',
				duration: elapsed,
				mediaUrl,
				mediaType,
				createdAt: new Date().toISOString(),
				order: 0
			};

			room.connect(getRoomServerUrl(), roomId);
			room.join(userName, '', clientId);
			await waitForSnapshot();
			room.addClip(clip);

			uploaded = true;
			console.log('[Record] Clip uploaded and registered:', clipId);

			setTimeout(() => {
				goto(`/${roomId}`);
			}, 1500);
		} catch (e) {
			console.error('[Record] Upload failed:', e);
			alert('Upload failed. Please try again.');
		} finally {
			uploading = false;
		}
	}

	function formatTime(s: number) {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}
</script>

<div class="flex min-h-dvh items-center justify-center px-3 sm:px-4 py-4 sm:py-8">
	<div class="w-full max-w-lg flex flex-col gap-5">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-xl font-bold tracking-tight">Record a pre-brief</h1>
				<p class="text-[13px] text-text-muted mt-0.5">
					Record a short video or audio clip for meeting prep
				</p>
			</div>
			<button
				onclick={() => goto(`/${roomId}`)}
				class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary"
				title="Back to room"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
			</button>
		</div>

		<!-- Title Input -->
		<input
			bind:value={title}
			placeholder="What's this clip about?"
			maxlength="100"
			class="bg-surface text-text-primary placeholder-text-muted w-full rounded-xl border border-white/5 px-4 py-3 text-base outline-none transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/20"
		/>

		<!-- Video Preview -->
		<div class="bg-surface relative aspect-video w-full overflow-hidden rounded-2xl border border-white/5 shadow-lg">
			{#if recorded && recordedUrl}
				<video
					bind:this={previewEl}
					src={recordedUrl}
					autoplay
					playsinline
					controls
					class="h-full w-full object-cover"
				></video>
			{:else if media.stream && media.videoEnabled}
				<video
					bind:this={videoEl}
					autoplay
					playsinline
					muted
					class="h-full w-full object-cover scale-x-[-1]"
				></video>
			{:else}
				<div class="flex h-full items-center justify-center">
					<div class="bg-surface-hover flex h-20 w-20 items-center justify-center rounded-full text-3xl font-medium text-text-secondary">
						{userName ? userName[0]?.toUpperCase() || '?' : '?'}
					</div>
				</div>
			{/if}

			<!-- Recording Indicator -->
			{#if recording}
				<div class="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-danger/90 px-3 py-1.5 text-[12px] font-semibold text-white shadow-lg backdrop-blur-sm">
					<span class="h-2 w-2 rounded-full bg-white animate-pulse"></span>
					<span>REC {formatTime(elapsed)}</span>
					{#if elapsed >= WARN_DURATION}
						<span class="text-white/70">({formatTime(MAX_DURATION - elapsed)} left)</span>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Timer Bar -->
		{#if recording}
			<div class="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
				<div
					class="h-full rounded-full transition-all duration-1000 ease-linear {elapsed >= WARN_DURATION ? 'bg-danger' : 'bg-accent'}"
					style="width: {(elapsed / MAX_DURATION) * 100}%"
				></div>
			</div>
		{/if}

		<!-- Controls -->
		<div class="flex items-center gap-3">
			{#if !recording && !recorded}
				<button
					onclick={startRecording}
					disabled={!media.stream}
					class="shiny-cta flex-1 px-6 py-3 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none"
				>
					<span>Start recording</span>
				</button>
			{:else if recording}
				<button
					onclick={stopRecording}
					class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border border-danger/30 bg-danger/10 px-6 py-3 text-base font-semibold text-danger transition-all hover:bg-danger/20 active:scale-[0.98]"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
					Stop recording
				</button>
			{:else if recorded}
				<button
					onclick={discardRecording}
					class="flex cursor-pointer items-center justify-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-5 py-3 text-[14px] font-medium text-text-secondary transition-all hover:bg-white/[0.06] hover:text-text-primary active:scale-[0.98]"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
					Redo
				</button>
				<button
					onclick={uploadClip}
					disabled={uploading || uploaded}
					class="shiny-cta flex-1 px-6 py-3 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none"
				>
					<span>
						{#if uploaded}
							Uploaded!
						{:else if uploading}
							Uploading...
						{:else}
							Save & share ({formatTime(elapsed)})
						{/if}
					</span>
				</button>
			{/if}
		</div>

		<!-- Info -->
		<p class="text-center text-[12px] text-text-muted">
			Max {MAX_DURATION / 60} minutes. Clips are shared with everyone who has the room link.
		</p>
	</div>
</div>
