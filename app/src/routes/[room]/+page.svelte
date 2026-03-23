<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { media } from '$lib/stores/media.svelte';
	import { loadPreferences, saveName } from '$lib/utils/preferences';
	import { playTestTone } from '$lib/utils/devices';

	let name = $state('');
	let joining = $state(false);
	let videoEl: HTMLVideoElement;
	let audioLevel = $state(0);
	let copied = $state(false);
	let nameInput: HTMLInputElement;
	let speakerLevel = $state(0);
	let micDropdown = $state(false);
	let camDropdown = $state(false);
	let spkDropdown = $state(false);
	let peekNames = $state<string[]>([]);
	let peekWs: WebSocket | null = null;

	let micCtx: AudioContext | null = null;
	let micAnalyser: AnalyserNode | null = null;
	let micData: Float32Array<ArrayBuffer> | null = null;
	let micRaf: number | null = null;

	const roomId = $derived($page.params.room);
	const shareUrl = $derived(typeof window !== 'undefined' ? window.location.href : '');

	function setupMicAnalyser(stream: MediaStream) {
		cleanupMicAnalyser();
		if (!stream.getAudioTracks().length) return;
		try {
			micCtx = new AudioContext();
			micAnalyser = micCtx.createAnalyser();
			micAnalyser.fftSize = 1024;
			micAnalyser.smoothingTimeConstant = 0.5;
			const source = micCtx.createMediaStreamSource(stream);
			source.connect(micAnalyser);
			micData = new Float32Array(micAnalyser.fftSize);

			function poll() {
				if (!micAnalyser || !micData) return;
				micAnalyser.getFloatTimeDomainData(micData);
				let sum = 0;
				for (let i = 0; i < micData.length; i++) sum += micData[i] * micData[i];
				const rms = Math.sqrt(sum / micData.length);
				audioLevel = Math.min(1, rms / 0.15);
				micRaf = requestAnimationFrame(poll);
			}
			poll();
		} catch (e) {
			console.warn('[PreJoin] Mic analyser failed:', e);
		}
	}

	function cleanupMicAnalyser() {
		if (micRaf !== null) cancelAnimationFrame(micRaf);
		micRaf = null;
		micAnalyser = null;
		if (micCtx) {
			micCtx.close().catch(() => {});
			micCtx = null;
		}
		micData = null;
		audioLevel = 0;
	}

	function peekRoom() {
		const env = import.meta.env.VITE_ROOM_SERVER_URL;
		const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
		const base = env || `${proto}://${window.location.host}/ws-room`;
		const wsUrl = `${base}/room/${roomId}`;

		console.log('[PreJoin] Peeking room at:', wsUrl);
		try {
			peekWs = new WebSocket(wsUrl);
			peekWs.onopen = () => {
				console.log('[PreJoin] Peek WS open, sending peek');
				peekWs?.send(JSON.stringify({ type: 'peek' }));
			};
			peekWs.onmessage = (e) => {
				console.log('[PreJoin] Peek WS message:', e.data);
				try {
					const msg = JSON.parse(e.data);
					if (msg.type === 'peek-result') {
						peekNames = msg.participants.map((p: { name: string }) => p.name);
						console.log('[PreJoin] Peek result:', peekNames);
						peekWs?.close();
						peekWs = null;
					}
				} catch {}
			};
			peekWs.onerror = (e) => {
				console.warn('[PreJoin] Peek WS error:', e);
			};
			peekWs.onclose = (e) => {
				console.log('[PreJoin] Peek WS closed:', e.code, e.reason);
			};
		} catch (e) {
			console.warn('[PreJoin] Peek failed:', e);
		}
	}

	onMount(async () => {
		const prefs = loadPreferences();
		name = prefs.name;

		peekRoom();

		await media.init();
		if (media.stream && videoEl) {
			videoEl.srcObject = media.stream;
		}
		if (media.stream) {
			setupMicAnalyser(media.stream);
		}

		nameInput?.focus();
	});

	onDestroy(() => {
		cleanupMicAnalyser();
		if (peekWs) {
			peekWs.onmessage = null;
			peekWs.close();
			peekWs = null;
		}
	});

	$effect(() => {
		if (videoEl && media.stream) {
			videoEl.srcObject = media.stream;
		}
	});

	$effect(() => {
		if (media.stream) {
			setupMicAnalyser(media.stream);
		}
	});

	function closeAllDropdowns() {
		micDropdown = false;
		camDropdown = false;
		spkDropdown = false;
	}

	$effect(() => {
		function onClick(e: MouseEvent) {
			const target = e.target as HTMLElement;
			if (!target.closest('[data-dropdown]')) closeAllDropdowns();
		}
		document.addEventListener('click', onClick, true);
		return () => document.removeEventListener('click', onClick, true);
	});

	function handleNameInput(e: Event) {
		const val = (e.target as HTMLInputElement).value;
		name = val;
		saveName(val);
	}

	async function joinCall() {
		if (!name.trim()) return;
		saveName(name.trim());
		joining = true;
		goto(`/${roomId}/call`);
	}

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(shareUrl);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {}
	}

	async function testSpeaker() {
		speakerLevel = 1;
		await playTestTone(media.selectedSpeaker);
		setTimeout(() => { speakerLevel = 0.8; }, 100);
		setTimeout(() => { speakerLevel = 0.5; }, 250);
		setTimeout(() => { speakerLevel = 0.2; }, 400);
		setTimeout(() => { speakerLevel = 0; }, 550);
	}
</script>

<div class="flex min-h-dvh items-center justify-center px-3 sm:px-4 py-4 sm:py-8">
	<div class="grid w-full max-w-4xl gap-5 sm:gap-10 md:grid-cols-[1.1fr_0.9fr]">
		<!-- Camera Preview + Controls -->
		<div class="flex flex-col gap-3">
			<div class="bg-surface relative aspect-[4/3] sm:aspect-video w-full overflow-hidden rounded-xl sm:rounded-2xl border border-white/5 shadow-lg">
				{#if media.error}
					<div class="flex h-full items-center justify-center p-6 text-center">
						<p class="text-text-secondary text-sm">{media.error}</p>
					</div>
				{:else if media.stream}
					<video
						bind:this={videoEl}
						autoplay
						playsinline
						muted
						class="h-full w-full object-cover scale-x-[-1] {media.videoEnabled ? '' : 'hidden'}"
					></video>
					{#if !media.videoEnabled}
						<div class="flex h-full items-center justify-center">
							<div class="bg-surface-hover flex h-20 w-20 items-center justify-center rounded-full text-3xl font-medium text-text-secondary">
								{name ? name[0]?.toUpperCase() || '?' : '?'}
							</div>
						</div>
					{/if}
				{:else}
					<div class="flex h-full items-center justify-center">
						<div class="text-text-muted text-sm">Loading camera...</div>
					</div>
				{/if}
			</div>

			<!-- Device Controls -->
			<div class="flex w-full flex-col gap-1.5">
				{@render deviceRow({
					icon: media.audioEnabled ? 'mic' : 'mic-off',
					label: media.mics.find(m => m.deviceId === media.selectedMic)?.label || 'Microphone',
					active: media.audioEnabled,
					onToggle: () => media.toggleAudio(),
					devices: media.mics,
					selectedDevice: media.selectedMic,
					onSelect: (id) => { media.switchMic(id); micDropdown = false; },
					dropdownOpen: micDropdown,
					onDropdownToggle: () => { micDropdown = !micDropdown; camDropdown = false; spkDropdown = false; },
					level: media.audioEnabled ? audioLevel : 0,
					levelColor: 'green'
				})}

				{@render deviceRow({
					icon: media.videoEnabled ? 'cam' : 'cam-off',
					label: media.cameras.find(c => c.deviceId === media.selectedCamera)?.label || 'Camera',
					active: media.videoEnabled,
					onToggle: () => media.toggleVideo(),
					devices: media.cameras,
					selectedDevice: media.selectedCamera,
					onSelect: (id) => { media.switchCamera(id); camDropdown = false; },
					dropdownOpen: camDropdown,
					onDropdownToggle: () => { camDropdown = !camDropdown; micDropdown = false; spkDropdown = false; },
					level: 0,
					levelColor: 'green'
				})}

				{#if media.speakers.length > 0}
					{@render deviceRow({
						icon: 'speaker',
						label: media.speakers.find(s => s.deviceId === media.selectedSpeaker)?.label || 'Speaker',
						active: true,
						onToggle: testSpeaker,
						devices: media.speakers,
						selectedDevice: media.selectedSpeaker,
						onSelect: (id) => { media.switchSpeaker(id); spkDropdown = false; },
						dropdownOpen: spkDropdown,
						onDropdownToggle: () => { spkDropdown = !spkDropdown; micDropdown = false; camDropdown = false; },
						level: speakerLevel,
						levelColor: 'accent'
					})}
				{/if}
			</div>
		</div>

		<!-- Join Form -->
		<div class="flex flex-col justify-center gap-4 sm:gap-5">
			<div>
				<h1 class="text-2xl font-bold tracking-tight">Ready to join?</h1>
				{#if peekNames.length > 0}
					<div class="mt-2.5 flex items-center gap-2.5">
						<div class="flex -space-x-2">
							{#each peekNames.slice(0, 5) as pName}
								<div class="flex h-7 w-7 items-center justify-center rounded-full bg-accent/20 text-[11px] font-semibold text-accent ring-2 ring-base">
									{pName[0]?.toUpperCase() || '?'}
								</div>
							{/each}
						</div>
						<span class="text-[13px] text-text-secondary leading-tight">
							{#if peekNames.length === 1}
								<span class="text-text-primary font-medium">{peekNames[0]}</span> is in the call
							{:else if peekNames.length === 2}
								<span class="text-text-primary font-medium">{peekNames[0]}</span> and <span class="text-text-primary font-medium">{peekNames[1]}</span> are in the call
							{:else}
								<span class="text-text-primary font-medium">{peekNames[0]}</span>, <span class="text-text-primary font-medium">{peekNames[1]}</span> + {peekNames.length - 2} more
							{/if}
						</span>
					</div>
				{:else}
					<p class="mt-1.5 text-[13px] text-text-muted">No one else is here yet</p>
				{/if}
			</div>

			<button
				onclick={copyLink}
				class="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-left transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.05] {copied ? 'border-green-500/30' : ''}"
			>
				<div class="min-w-0 flex-1">
					<div class="text-text-muted text-[10px] font-semibold uppercase tracking-widest">Invite link</div>
					<div class="text-text-secondary group-hover:text-text-primary mt-0.5 truncate font-mono text-[13px] transition-colors">
						{shareUrl}
					</div>
				</div>
				<div class="flex-shrink-0 text-text-muted transition-colors group-hover:text-text-primary">
					{#if copied}
						<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-400"><path d="M20 6 9 17l-5-5"/></svg>
					{:else}
						<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
					{/if}
				</div>
			</button>

			<div class="space-y-3">
				<input
					bind:this={nameInput}
					bind:value={name}
					oninput={handleNameInput}
					placeholder="Your name"
					maxlength="50"
					class="bg-surface text-text-primary placeholder-text-muted w-full rounded-xl border border-white/5 px-4 py-3 text-base outline-none transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/20"
					onkeydown={(e) => e.key === 'Enter' && joinCall()}
				/>

				<button
					onclick={joinCall}
					disabled={!name.trim() || joining || !media.permissionGranted}
					class="shiny-cta w-full px-8 py-3 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none"
				>
					<span>{joining ? 'Joining...' : 'Join call'}</span>
				</button>
			</div>
		</div>
	</div>
</div>

{#snippet deviceRow(props: {
	icon: string;
	label: string;
	active: boolean;
	onToggle: () => void;
	devices: import('$lib/utils/devices').DeviceInfo[];
	selectedDevice: string;
	onSelect: (id: string) => void;
	dropdownOpen: boolean;
	onDropdownToggle: () => void;
	level: number;
	levelColor: string;
})}
	<div class="relative" data-dropdown>
		<div class="flex items-stretch overflow-hidden rounded-xl border border-white/[0.06] {props.active ? 'bg-surface' : 'bg-danger/10 border-danger/20'}">
			<button
				onclick={props.onToggle}
				class="flex flex-1 cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-[13px] transition-colors hover:bg-white/[0.04] {props.active ? 'text-text-primary' : 'text-danger'}"
			>
				<span class="flex h-5 w-5 shrink-0 items-center justify-center {props.active ? 'text-text-secondary' : 'text-danger/70'}">
					{#if props.icon === 'mic'}
						<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
					{:else if props.icon === 'mic-off'}
						<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 0"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
					{:else if props.icon === 'cam'}
						<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
					{:else if props.icon === 'cam-off'}
						<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
					{:else}
						<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
					{/if}
				</span>
				<span class="min-w-0 flex-1 truncate">{props.label}</span>
				{#if props.level > 0}
					<div class="ml-1 flex h-3.5 items-end gap-[2px]">
						{#each Array(5) as _, i}
							<div
								class="w-[3px] rounded-full transition-all duration-100 {props.level > i * 0.2 ? (props.levelColor === 'green' ? 'bg-green-400' : 'bg-accent') : 'bg-white/[0.08]'}"
								style="height: {2 + i * 2}px"
							></div>
						{/each}
					</div>
				{/if}
			</button>
			{#if props.devices.length > 1}
				<button
					onclick={props.onDropdownToggle}
					class="flex cursor-pointer items-center border-l border-white/[0.06] px-2.5 text-text-muted transition-colors hover:bg-white/[0.04] hover:text-text-primary {props.dropdownOpen ? 'bg-white/[0.04] text-text-primary' : ''}"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
				</button>
			{/if}
		</div>
		{#if props.dropdownOpen}
			<div class="absolute left-0 top-full z-30 mt-1.5 w-full rounded-xl border border-white/10 bg-[#18181b]/98 p-1 shadow-2xl backdrop-blur-xl">
				{#each props.devices as device (device.deviceId)}
					<button
						onclick={() => props.onSelect(device.deviceId)}
						class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.06] {device.deviceId === props.selectedDevice ? 'text-accent' : 'text-text-secondary'}"
					>
						{#if device.deviceId === props.selectedDevice}
							<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
						{:else}
							<span class="w-[13px]"></span>
						{/if}
						<span class="truncate">{device.label}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}
