<script lang="ts">
	import type { DeviceInfo } from '$lib/utils/devices';

	let {
		audioEnabled = true,
		videoEnabled = true,
		screenEnabled = false,
		chatOpen = false,
		unreadChat = false,
		roomId = '',
		showInvite = false,
		mics = [],
		cameras = [],
		speakers = [],
		selectedMic = '',
		selectedCamera = '',
		selectedSpeaker = '',
		connectionQuality = 'unknown',
		onToggleAudio,
		onToggleVideo,
		onToggleScreen,
		onToggleChat,
		onLeave,
		onSwitchMic,
		onSwitchCamera,
		onSwitchSpeaker,
		onInviteOpenChange
	}: {
		audioEnabled?: boolean;
		videoEnabled?: boolean;
		screenEnabled?: boolean;
		chatOpen?: boolean;
		unreadChat?: boolean;
		roomId?: string;
		showInvite?: boolean;
		mics?: DeviceInfo[];
		cameras?: DeviceInfo[];
		speakers?: DeviceInfo[];
		selectedMic?: string;
		selectedCamera?: string;
		selectedSpeaker?: string;
		connectionQuality?: 'good' | 'fair' | 'poor' | 'unknown';
		onToggleAudio: () => void;
		onToggleVideo: () => void;
		onToggleScreen: () => void;
		onToggleChat: () => void;
		onLeave: () => void;
		onSwitchMic?: (id: string) => void;
		onSwitchCamera?: (id: string) => void;
		onSwitchSpeaker?: (id: string) => void;
		onInviteOpenChange?: (open: boolean) => void;
	} = $props();

	const qualityColor = $derived(
		connectionQuality === 'good' ? 'text-green-400' :
		connectionQuality === 'fair' ? 'text-yellow-400' :
		connectionQuality === 'poor' ? 'text-red-400' : 'text-text-muted'
	);
	const qualityLabel = $derived(
		connectionQuality === 'good' ? 'Good connection' :
		connectionQuality === 'fair' ? 'Fair connection' :
		connectionQuality === 'poor' ? 'Poor connection' : 'Connecting...'
	);

	let inviteOpen = $state(false);
	let inviteAutoOpened = $state(false);

	$effect(() => {
		onInviteOpenChange?.(inviteOpen);
	});

	export function openInvite() {
		inviteOpen = true;
		copyInvite();
	}

	let micMenu = $state(false);
	let camMenu = $state(false);
	let spkMenu = $state(false);

	function closeAllMenus() {
		micMenu = false;
		camMenu = false;
		spkMenu = false;
	}

	$effect(() => {
		if (showInvite && !inviteAutoOpened) {
			inviteOpen = true;
			inviteAutoOpened = true;
		}
		if (!showInvite) {
			if (inviteAutoOpened && inviteOpen) {
				inviteOpen = false;
			}
			inviteAutoOpened = false;
		}
	});
	let copied = $state(false);

	const inviteUrl = $derived(
		typeof window !== 'undefined' ? `${window.location.origin}/${roomId}` : ''
	);

	async function copyInvite() {
		try {
			await navigator.clipboard.writeText(inviteUrl);
			copied = true;
			setTimeout(() => (copied = false), 2000);
			setTimeout(() => { inviteOpen = false; }, 2500);
		} catch {}
	}

	$effect(() => {
		function handleClickOutside(e: MouseEvent) {
			const target = e.target as HTMLElement;
			if (inviteOpen && !target.closest('[data-invite-popup]')) {
				inviteOpen = false;
			}
			if (!target.closest('[data-device-menu]')) {
				closeAllMenus();
			}
		}
		document.addEventListener('click', handleClickOutside, true);
		return () => document.removeEventListener('click', handleClickOutside, true);
	});

	let barEl: HTMLDivElement;
	let offsetX = $state(0);
	let offsetY = $state(0);
	let dragging = $state(false);
	let dragStartX = 0;
	let dragStartY = 0;
	let dragOriginOffsetX = 0;
	let dragOriginOffsetY = 0;
	let didMove = false;

	function onDragStart(e: PointerEvent) {
		if ((e.target as HTMLElement).closest('button')) return;
		dragging = true;
		didMove = false;
		dragStartX = e.clientX;
		dragStartY = e.clientY;
		dragOriginOffsetX = offsetX;
		dragOriginOffsetY = offsetY;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onDragMove(e: PointerEvent) {
		if (!dragging) return;
		const dx = e.clientX - dragStartX;
		const dy = e.clientY - dragStartY;
		if (!didMove && Math.abs(dx) + Math.abs(dy) < 4) return;
		didMove = true;

		const newX = dragOriginOffsetX + dx;
		const newY = dragOriginOffsetY + dy;

		if (barEl) {
			const rect = barEl.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const halfW = rect.width / 2;
			const maxX = vw / 2 - halfW - 8;
			const maxUp = vh - 20 - rect.height - 8;
			offsetX = Math.max(-maxX, Math.min(maxX, newX));
			offsetY = Math.max(-maxUp, Math.min(0, newY));
		} else {
			offsetX = newX;
			offsetY = newY;
		}
	}

	function onDragEnd() {
		dragging = false;
	}
</script>

<div class="fixed bottom-0 left-0 right-0 z-50 flex justify-center px-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5 pointer-events-none">
	<div
		bind:this={barEl}
		class="pointer-events-auto flex items-center gap-0.5 sm:gap-1 rounded-2xl border border-white/[0.08] bg-[#141416]/90 px-1.5 sm:px-2 py-1.5 sm:py-2 shadow-2xl backdrop-blur-xl {dragging ? '' : 'transition-transform duration-200'}"
		style="transform: translate({offsetX}px, {offsetY}px)"
	>
		<!-- Mic with device picker -->
		<div class="relative flex items-stretch" data-device-menu>
			<button
				onclick={onToggleAudio}
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-l-xl transition-all duration-150 active:scale-90
					{!audioEnabled ? 'bg-danger/15 text-danger hover:bg-danger/25' : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'}
					{mics.length <= 1 ? 'rounded-r-xl' : ''}"
				title={audioEnabled ? 'Mute (M)' : 'Unmute (M)'}
			>
				{@render icon(audioEnabled ? 'mic' : 'mic-off')}
			</button>
			{#if mics.length > 1}
				<button
					onclick={() => { micMenu = !micMenu; camMenu = false; spkMenu = false; }}
					class="hidden sm:flex h-10 w-5 cursor-pointer items-center justify-center rounded-r-xl border-l border-white/[0.06] transition-all duration-150
						{!audioEnabled ? 'bg-danger/15 text-danger/60 hover:bg-danger/25 hover:text-danger' : 'text-text-muted hover:bg-white/[0.06] hover:text-text-primary'}
						{micMenu ? 'bg-white/[0.06] text-text-primary' : ''}"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
				</button>
			{/if}
			{#if micMenu}
				{@render deviceMenu(mics, selectedMic, (id) => { onSwitchMic?.(id); micMenu = false; }, 'Microphone')}
			{/if}
		</div>

		<!-- Camera with device picker -->
		<div class="relative flex items-stretch" data-device-menu>
			<button
				onclick={onToggleVideo}
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-l-xl transition-all duration-150 active:scale-90
					{!videoEnabled ? 'bg-danger/15 text-danger hover:bg-danger/25' : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'}
					{cameras.length <= 1 ? 'rounded-r-xl' : ''}"
				title={videoEnabled ? 'Camera off (V)' : 'Camera on (V)'}
			>
				{@render icon(videoEnabled ? 'cam' : 'cam-off')}
			</button>
			{#if cameras.length > 1}
				<button
					onclick={() => { camMenu = !camMenu; micMenu = false; spkMenu = false; }}
					class="hidden sm:flex h-10 w-5 cursor-pointer items-center justify-center rounded-r-xl border-l border-white/[0.06] transition-all duration-150
						{!videoEnabled ? 'bg-danger/15 text-danger/60 hover:bg-danger/25 hover:text-danger' : 'text-text-muted hover:bg-white/[0.06] hover:text-text-primary'}
						{camMenu ? 'bg-white/[0.06] text-text-primary' : ''}"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
				</button>
			{/if}
			{#if camMenu}
				{@render deviceMenu(cameras, selectedCamera, (id) => { onSwitchCamera?.(id); camMenu = false; }, 'Camera')}
			{/if}
		</div>

		<!-- Speaker picker (hidden on mobile, rarely multiple speakers on phones) -->
		{#if speakers.length > 1}
			<div class="relative hidden sm:flex items-stretch" data-device-menu>
				<button
					onclick={() => { spkMenu = !spkMenu; micMenu = false; camMenu = false; }}
					class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl transition-all duration-150 active:scale-90 text-text-secondary hover:bg-white/[0.06] hover:text-text-primary
						{spkMenu ? 'bg-white/[0.06] text-text-primary' : ''}"
					title="Speaker"
				>
					{@render icon('speaker')}
				</button>
				{#if spkMenu}
					{@render deviceMenu(speakers, selectedSpeaker, (id) => { onSwitchSpeaker?.(id); spkMenu = false; }, 'Speaker')}
				{/if}
			</div>
		{/if}

		<!-- Screen share (hidden on mobile — not supported) -->
		<button
			onclick={onToggleScreen}
			class="hidden sm:flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl transition-all duration-150 active:scale-90
				{screenEnabled ? 'bg-accent/15 text-accent hover:bg-accent/25' : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'}"
			title={screenEnabled ? 'Stop sharing' : 'Share screen'}
		>
			{@render icon('screen')}
		</button>

		<!-- Invite -->
		<div class="relative" data-invite-popup>
			<button
				onclick={() => { inviteOpen = !inviteOpen; if (inviteOpen) copyInvite(); }}
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl transition-all duration-150 active:scale-90
					{inviteOpen ? 'bg-accent/15 text-accent hover:bg-accent/25' : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'}"
				title="Invite people"
			>
				{@render icon('invite')}
			</button>

			{#if inviteOpen}
				<div class="fixed sm:absolute bottom-full left-2 right-2 sm:left-1/2 mb-3 sm:w-72 sm:-translate-x-1/2 sm:right-auto rounded-xl border border-white/[0.08] bg-[#18181b]/98 p-3.5 shadow-2xl backdrop-blur-xl sm:bottom-full bottom-16">
					{#if showInvite}
						<div class="mb-2.5 flex items-center gap-2 text-[13px] text-text-secondary">
							<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-text-muted"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>
							No one else is here yet — invite someone!
						</div>
					{:else}
						<div class="mb-1.5 text-[13px] font-semibold">Invite people</div>
						<div class="text-text-muted mb-2.5 text-[12px] leading-relaxed">Share this link to let others join.</div>
					{/if}
					<div class="flex gap-1.5">
						<div class="bg-surface min-w-0 flex-1 truncate rounded-lg border border-white/[0.06] px-2.5 py-1.5 font-mono text-[11px] text-text-secondary">
							{inviteUrl}
						</div>
						<button
							onclick={copyInvite}
							class="flex-shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition-all duration-150 {copied
								? 'bg-green-600'
								: 'bg-accent hover:bg-accent-hover'}"
						>
							{copied ? 'Copied!' : 'Copy'}
						</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- Chat -->
		<div class="relative">
			<button
				onclick={onToggleChat}
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl transition-all duration-150 active:scale-90
					{chatOpen ? 'bg-accent/15 text-accent hover:bg-accent/25' : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'}"
				title="Toggle chat (C)"
			>
				{@render icon('chat')}
			</button>
			{#if unreadChat && !chatOpen}
				<span class="absolute -top-0.5 -right-0.5 flex h-3 w-3">
					<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75"></span>
					<span class="relative inline-flex h-3 w-3 rounded-full bg-accent"></span>
				</span>
			{/if}
		</div>

		<!-- Drag handle (hidden on mobile — touch conflicts) -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="mx-0.5 hidden sm:flex h-8 w-4 cursor-grab items-center justify-center rounded active:cursor-grabbing"
			onpointerdown={onDragStart}
			onpointermove={onDragMove}
			onpointerup={onDragEnd}
			onpointercancel={onDragEnd}
		>
			<svg width="6" height="14" viewBox="0 0 6 14" fill="none" class="text-white/20">
				<circle cx="1.5" cy="1.5" r="1" fill="currentColor"/>
				<circle cx="4.5" cy="1.5" r="1" fill="currentColor"/>
				<circle cx="1.5" cy="5" r="1" fill="currentColor"/>
				<circle cx="4.5" cy="5" r="1" fill="currentColor"/>
				<circle cx="1.5" cy="8.5" r="1" fill="currentColor"/>
				<circle cx="4.5" cy="8.5" r="1" fill="currentColor"/>
				<circle cx="1.5" cy="12" r="1" fill="currentColor"/>
				<circle cx="4.5" cy="12" r="1" fill="currentColor"/>
			</svg>
		</div>

		<!-- Leave -->
		<button
			onclick={onLeave}
			class="bg-danger hover:bg-danger-hover flex h-10 cursor-pointer items-center rounded-xl px-3 sm:px-4 text-[13px] font-semibold text-white transition-all duration-150 active:scale-95"
		>
			Leave
		</button>
	</div>
</div>

{#snippet icon(name: string)}
	<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		{#if name === 'mic'}
			<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>
		{:else if name === 'mic-off'}
			<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 0"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>
		{:else if name === 'cam'}
			<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>
		{:else if name === 'cam-off'}
			<path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><line x1="2" x2="22" y1="2" y2="22"/>
		{:else if name === 'screen'}
			<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>
		{:else if name === 'speaker'}
			<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
		{:else if name === 'invite'}
			<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>
		{:else if name === 'chat'}
			<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
		{/if}
	</svg>
{/snippet}

{#snippet deviceMenu(devices: DeviceInfo[], selectedId: string, onSelect: (id: string) => void, title: string)}
	<div class="fixed sm:absolute bottom-16 sm:bottom-full left-2 right-2 sm:left-1/2 sm:right-auto sm:mb-2 sm:w-64 sm:-translate-x-1/2 rounded-xl border border-white/[0.08] bg-[#18181b]/98 p-1.5 shadow-2xl backdrop-blur-xl">
		<div class="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{title}</div>
		{#each devices as device (device.deviceId)}
			<button
				onclick={() => onSelect(device.deviceId)}
				class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.06]
					{device.deviceId === selectedId ? 'text-accent' : 'text-text-secondary'}"
			>
				{#if device.deviceId === selectedId}
					<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
				{:else}
					<span class="w-[13px]"></span>
				{/if}
				<span class="truncate">{device.label}</span>
			</button>
		{/each}
	</div>
{/snippet}
