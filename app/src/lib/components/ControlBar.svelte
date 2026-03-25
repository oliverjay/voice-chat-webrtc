<script lang="ts">
	import type { DeviceInfo } from '$lib/utils/devices';
	import { personas } from '$lib/agents/personas';

	let {
		audioEnabled = true,
		videoEnabled = true,
		speakerMuted = false,
		screenEnabled = false,
		chatOpen = false,
		unreadChat = false,
		roomId = '',
		showInvite = false,
		isAlone = true,
		mics = [],
		cameras = [],
		speakers = [],
		selectedMic = '',
		selectedCamera = '',
		selectedSpeaker = '',
		connectionQuality = 'unknown',
		activeAgents = new Set<string>(),
		loadingAgents = new Set<string>(),
		onToggleAudio,
		onToggleVideo,
		onToggleSpeaker,
		onToggleScreen,
		onToggleChat,
		onLeave,
		onSwitchMic,
		onSwitchCamera,
		onSwitchSpeaker,
		onInviteOpenChange,
		onAddAgent,
		onRemoveAgent
	}: {
		audioEnabled?: boolean;
		videoEnabled?: boolean;
		speakerMuted?: boolean;
		screenEnabled?: boolean;
		chatOpen?: boolean;
		unreadChat?: boolean;
		roomId?: string;
		showInvite?: boolean;
		isAlone?: boolean;
		mics?: DeviceInfo[];
		cameras?: DeviceInfo[];
		speakers?: DeviceInfo[];
		selectedMic?: string;
		selectedCamera?: string;
		selectedSpeaker?: string;
		connectionQuality?: 'good' | 'fair' | 'poor' | 'unknown';
		activeAgents?: Set<string>;
		loadingAgents?: Set<string>;
		onToggleAudio: () => void;
		onToggleVideo: () => void;
		onToggleSpeaker: () => void;
		onToggleScreen: () => void;
		onToggleChat: () => void;
		onLeave: () => void;
		onSwitchMic?: (id: string) => void;
		onSwitchCamera?: (id: string) => void;
		onSwitchSpeaker?: (id: string) => void;
		onInviteOpenChange?: (open: boolean) => void;
		onAddAgent?: (slug: string) => void;
		onRemoveAgent?: (slug: string) => void;
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
	let longPressed = false;
	let pressTimer: ReturnType<typeof setTimeout>;
	let hoverTimer: ReturnType<typeof setTimeout>;
	let nudgeDismissed = $state(false);
	let nudgeTimer: ReturnType<typeof setTimeout>;

	function closeAllMenus() {
		micMenu = false;
		camMenu = false;
		spkMenu = false;
	}

	const showNudge = $derived(isAlone && !inviteOpen && !nudgeDismissed);

	$effect(() => {
		clearTimeout(nudgeTimer);
		if (showNudge) {
			nudgeTimer = setTimeout(() => { nudgeDismissed = true; }, 8000);
		}
		return () => clearTimeout(nudgeTimer);
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
	let lastTapTime = 0;

	function resetPosition() {
		offsetX = 0;
		offsetY = 0;
	}

	function onDragStart(e: PointerEvent) {
		if ((e.target as HTMLElement).closest('button')) return;
		const now = Date.now();
		if (now - lastTapTime < 300) {
			resetPosition();
			lastTapTime = 0;
			return;
		}
		lastTapTime = now;
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

<div class="fixed bottom-0 left-0 right-0 z-50 flex justify-center px-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5 pointer-events-none transition-all duration-300 {screenEnabled ? 'sm:pb-14' : ''}" >
	<div
		bind:this={barEl}
		class="pointer-events-auto flex items-center gap-0.5 sm:gap-1 rounded-2xl border border-white/[0.08] bg-[#141416]/90 px-1.5 sm:px-2 py-1.5 sm:py-2 shadow-2xl backdrop-blur-xl {dragging ? '' : 'transition-transform duration-200'}"
		style="transform: translate({offsetX}px, {offsetY}px)"
	>
		<!-- Mic -->
		{@render mediaControl({
			enabled: audioEnabled,
			onToggle: onToggleAudio,
			iconOn: 'mic',
			iconOff: 'mic-off',
			titleOn: 'Mute (M)',
			titleOff: 'Unmute (M)',
			devices: mics,
			selectedDevice: selectedMic,
			onSwitchDevice: onSwitchMic,
			menuLabel: 'Microphone',
			menuOpen: micMenu,
			onMenuToggle: () => { micMenu = !micMenu; camMenu = false; spkMenu = false; },
		})}

		<!-- Camera -->
		{@render mediaControl({
			enabled: videoEnabled,
			onToggle: onToggleVideo,
			iconOn: 'cam',
			iconOff: 'cam-off',
			titleOn: 'Camera off (V)',
			titleOff: 'Camera on (V)',
			devices: cameras,
			selectedDevice: selectedCamera,
			onSwitchDevice: onSwitchCamera,
			menuLabel: 'Camera',
			menuOpen: camMenu,
			onMenuToggle: () => { camMenu = !camMenu; micMenu = false; spkMenu = false; },
		})}

		<!-- Speaker -->
		{@render mediaControl({
			enabled: !speakerMuted,
			onToggle: onToggleSpeaker,
			iconOn: 'speaker',
			iconOff: 'speaker-off',
			titleOn: 'Mute speaker',
			titleOff: 'Unmute speaker',
			devices: speakers,
			selectedDevice: selectedSpeaker,
			onSwitchDevice: onSwitchSpeaker,
			menuLabel: 'Speaker',
			menuOpen: spkMenu,
			onMenuToggle: () => { spkMenu = !spkMenu; micMenu = false; camMenu = false; },
		})}

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
				onclick={() => { nudgeDismissed = true; inviteOpen = !inviteOpen; if (inviteOpen) copyInvite(); }}
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl transition-all duration-150 active:scale-90
					{inviteOpen ? 'bg-accent/15 text-accent hover:bg-accent/25' : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'}
					{showNudge ? 'animate-invite-glow' : ''}"
				title="Invite people"
			>
				{@render icon('invite')}
			</button>

			{#if showNudge}
				<button
					onclick={() => { nudgeDismissed = true; inviteOpen = true; copyInvite(); }}
					class="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-10 cursor-pointer whitespace-nowrap rounded-lg bg-white px-3 py-1.5 text-[13px] font-medium text-gray-900 shadow-lg transition-all duration-150 hover:bg-gray-100 active:scale-95"
				>
					Invite someone to join
					<div class="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-white"></div>
				</button>
			{/if}

		{#if inviteOpen}
			<div class="fixed sm:absolute bottom-full left-2 right-2 sm:left-1/2 mb-3 sm:w-80 sm:-translate-x-1/2 sm:right-auto rounded-xl border border-white/[0.08] bg-[#18181b]/98 p-3.5 shadow-2xl backdrop-blur-xl sm:bottom-full bottom-16">
				<!-- AI Agents section -->
				<div class="mb-3">
					<div class="mb-2.5 text-[12px] font-semibold uppercase tracking-wider text-text-muted">AI Agents</div>
					<div class="flex gap-2">
						{#each personas as persona, i}
							{@const isActive = activeAgents.has(persona.slug)}
							{@const isLoading = loadingAgents.has(persona.slug)}
							<button
								onclick={() => {
									if (isLoading) return;
									if (isActive) onRemoveAgent?.(persona.slug);
									else onAddAgent?.(persona.slug);
								}}
								class="group flex flex-1 flex-col items-center gap-1.5 rounded-xl border p-2 transition-all duration-200 cursor-pointer
									{isActive
										? 'border-accent/30 bg-accent/[0.06]'
										: isLoading
											? 'border-white/[0.08] bg-white/[0.02] opacity-70'
											: 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04] hover:scale-[1.03]'}"
								style="animation-delay: {i * 50}ms"
								disabled={isLoading}
							>
							<div class="relative h-12 w-12 overflow-hidden rounded-full ring-2 transition-all duration-200 {isActive ? 'ring-green-400/60' : isLoading ? 'ring-white/[0.1]' : 'ring-white/[0.1] group-hover:ring-white/[0.2]'}">
								<img
									src={persona.avatarUrl}
									alt={persona.name}
									class="h-full w-full object-cover"
								/>
								{#if isLoading}
									<div class="absolute inset-0 flex items-center justify-center bg-black/40">
										<svg class="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
											<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" opacity="0.25"/>
											<path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
										</svg>
									</div>
								{/if}
							</div>
							<div class="text-center">
								<div class="text-[13px] font-semibold text-text-primary leading-tight">{persona.name.split(' ').pop()}</div>
								<div class="text-[11px] text-text-muted leading-tight">{persona.tagline}</div>
							</div>
							<div class="text-[12px] font-medium {isActive ? 'text-red-400 group-hover:text-red-300' : isLoading ? 'text-text-muted' : 'text-accent'}">
								{isActive ? 'Disconnect' : isLoading ? 'Adding...' : '+ Add'}
							</div>
							</button>
						{/each}
					</div>
				</div>

				<!-- Divider -->
				<div class="flex items-center gap-2 mb-3">
					<div class="flex-1 h-px bg-white/[0.06]"></div>
					<span class="text-[11px] text-text-muted">or invite someone</span>
					<div class="flex-1 h-px bg-white/[0.06]"></div>
				</div>

				<!-- Link invite -->
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

{#snippet mediaControl(opts: {
	enabled: boolean;
	onToggle: () => void;
	iconOn: string;
	iconOff: string;
	titleOn: string;
	titleOff: string;
	devices: DeviceInfo[];
	selectedDevice: string;
	onSwitchDevice?: (id: string) => void;
	menuLabel: string;
	menuOpen: boolean;
	onMenuToggle: () => void;
})}
	{@const hasMultiple = opts.devices.length > 1}
	<div
		class="relative flex items-stretch"
		data-device-menu
		onmouseenter={() => { if (hasMultiple) { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => { closeAllMenus(); opts.onMenuToggle(); }, 400); } }}
		onmouseleave={() => { clearTimeout(hoverTimer); if (opts.menuOpen) { hoverTimer = setTimeout(() => { if (opts.menuOpen) opts.onMenuToggle(); }, 300); } }}
	>
		<button
			onclick={(e) => { if (!longPressed) opts.onToggle(); longPressed = false; }}
			oncontextmenu={(e) => { if (hasMultiple) { e.preventDefault(); closeAllMenus(); opts.onMenuToggle(); } }}
			onpointerdown={(e) => {
				if (!hasMultiple || e.pointerType === 'mouse') return;
				longPressed = false;
				pressTimer = setTimeout(() => { longPressed = true; closeAllMenus(); opts.onMenuToggle(); }, 500);
			}}
			onpointerup={() => { clearTimeout(pressTimer); }}
			onpointercancel={() => { clearTimeout(pressTimer); }}
			class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl transition-all duration-150 active:scale-90
				{!opts.enabled ? 'bg-danger/15 text-danger hover:bg-danger/25' : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'}"
			title={opts.enabled ? opts.titleOn : opts.titleOff}
		>
			{@render icon(opts.enabled ? opts.iconOn : opts.iconOff)}
		</button>
		{#if opts.menuOpen}
			{@render deviceMenu(opts.devices, opts.selectedDevice, (id) => { opts.onSwitchDevice?.(id); opts.onMenuToggle(); }, opts.menuLabel)}
		{/if}
	</div>
{/snippet}

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
		{:else if name === 'speaker-off'}
			<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>
		{:else if name === 'invite'}
			<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>
		{:else if name === 'chat'}
			<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
		{/if}
	</svg>
{/snippet}

{#snippet deviceMenu(devices: DeviceInfo[], selectedId: string, onSelect: (id: string) => void, title: string)}
	<div class="fixed sm:absolute bottom-16 sm:bottom-full left-2 right-2 sm:left-1/2 sm:right-auto sm:mb-2 sm:w-64 sm:-translate-x-1/2 z-20 rounded-xl border border-white/[0.08] bg-[#18181b]/98 p-1.5 shadow-2xl backdrop-blur-xl">
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
