<script lang="ts">
	import { browser } from '$app/environment';
	import type { ChatMessage } from '$lib/room/protocol';
	import {
		isBrowserSpeechRecognitionSupported,
		startContinuousDictation,
		stopActiveSpeechRecognition
	} from '$lib/utils/speech-recognition';

	let {
		open = false,
		messages = [],
		myId = '',
		agentParticipantIds = new Set<string>(),
		agentTypingIds = new Set<string>(),
		agentNames = new Map<string, string>(),
		onSend,
		onClose
	}: {
		open?: boolean;
		messages?: ChatMessage[];
		myId?: string;
		agentParticipantIds?: Set<string>;
		agentTypingIds?: Set<string>;
		agentNames?: Map<string, string>;
		onSend: (text: string) => void;
		onClose: () => void;
	} = $props();

	let inputText = $state('');
	let voiceBusy = $state(false);
	let voiceInterim = $state('');
	let messagesEl: HTMLDivElement;
	let inputEl: HTMLInputElement;

	const sttAvailable = $derived(browser && isBrowserSpeechRecognitionSupported());

	$effect(() => {
		if (messages.length && messagesEl) {
			messagesEl.scrollTop = messagesEl.scrollHeight;
		}
	});

	$effect(() => {
		if (open && inputEl) {
			setTimeout(() => inputEl?.focus(), 50);
		}
	});

	function send() {
		const text = inputText.trim();
		if (!text) return;
		onSend(text);
		inputText = '';
	}

	let sendTimer: ReturnType<typeof setTimeout> | null = null;
	let voiceBuffer = '';
	let lastFinalSegment = '';
	const VOICE_SEND_DELAY = 2500;

	function flushVoiceBuffer() {
		if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
		const text = voiceBuffer.trim();
		voiceBuffer = '';
		lastFinalSegment = '';
		if (text) {
			onSend(text);
		}
	}

	function scheduleVoiceSend() {
		if (sendTimer) clearTimeout(sendTimer);
		sendTimer = setTimeout(flushVoiceBuffer, VOICE_SEND_DELAY);
	}

	function toggleVoiceToText() {
		if (!sttAvailable) {
			console.warn('[Chat] Speech recognition needs Chrome, Edge, or Safari.');
			return;
		}
		if (voiceBusy) {
			stopActiveSpeechRecognition();
			flushVoiceBuffer();
			voiceBusy = false;
			voiceInterim = '';
			return;
		}
		voiceInterim = '';
		voiceBuffer = '';
		lastFinalSegment = '';
		voiceBusy = true;
		startContinuousDictation('en-US', {
			onInterim: (t) => {
				if (agentTypingIds.size > 0) {
					voiceInterim = '';
					return;
				}
				voiceInterim = t;
			},
			onFinalSegment: (segment) => {
				voiceInterim = '';
				if (agentTypingIds.size > 0) {
					console.log('[ChatPanel] Suppressed voice segment (agent speaking):', segment.slice(0, 80));
					return;
				}
				const s = segment.trim();
				if (!s) return;
				if (s === lastFinalSegment) {
					console.log('[ChatPanel] Deduplicated segment:', s.slice(0, 80));
					return;
				}
				lastFinalSegment = s;
				console.log('[ChatPanel] Voice segment:', s.slice(0, 200));
				voiceBuffer = (voiceBuffer + ' ' + s).trim();
				scheduleVoiceSend();
			},
			onError: (code) => {
				flushVoiceBuffer();
				voiceBusy = false;
				voiceInterim = '';
				if (code !== 'aborted' && code !== 'no-speech') {
					console.warn('[Chat] Speech:', code);
				}
			}
		});
	}
</script>

<div
	class="fixed right-0 top-0 z-40 flex w-full sm:w-80 flex-col border-l border-white/[0.06] bg-[#111113] sm:bg-[#111113]/95 shadow-2xl sm:backdrop-blur-xl transition-transform duration-300 ease-in-out bottom-[4.5rem] sm:bottom-0 sm:h-full"
	style="transform: translateX({open ? '0' : '100%'})"
>
	<div class="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
		<span class="text-[13px] font-semibold">Chat</span>
		<button
			onclick={onClose}
			class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
				<path d="M18 6 6 18"/><path d="m6 6 12 12"/>
			</svg>
		</button>
	</div>

	<div bind:this={messagesEl} class="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
		{#each messages as msg (msg.id)}
			{@const isAgentMsg = agentParticipantIds.has(msg.participantId)}
			<div class={msg.participantId === myId ? 'text-right' : ''}>
				<div class="text-[11px] mb-0.5 font-medium flex items-center gap-1 {msg.participantId === myId ? 'justify-end' : ''}">
					<span class="text-text-muted">{msg.name}</span>
					{#if isAgentMsg}
						<span class="inline-flex items-center rounded-full bg-accent/15 px-1.5 py-0 text-[8px] font-bold text-accent-subtle uppercase tracking-wider">AI</span>
					{/if}
				</div>
				<div class="inline-block max-w-[85%] rounded-xl px-3 py-1.5 text-[13px] leading-relaxed
					{msg.participantId === myId
						? 'bg-accent/15 text-text-primary'
						: isAgentMsg
							? 'bg-accent/[0.07] text-text-primary border border-accent/10'
							: 'bg-white/[0.04] text-text-primary'}">
					{msg.text}
				</div>
			</div>
		{/each}

		{#each [...agentTypingIds] as typingId (typingId)}
			<div>
				<div class="text-[11px] mb-0.5 font-medium flex items-center gap-1">
					<span class="text-text-muted">{agentNames.get(typingId) || 'Agent'}</span>
					<span class="inline-flex items-center rounded-full bg-accent/15 px-1.5 py-0 text-[8px] font-bold text-accent-subtle uppercase tracking-wider">AI</span>
				</div>
				<div class="inline-flex items-center gap-1 rounded-xl bg-accent/[0.07] border border-accent/10 px-3 py-2">
					<span class="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-accent/60"></span>
					<span class="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-accent/60"></span>
					<span class="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-accent/60"></span>
				</div>
			</div>
		{/each}

		{#if messages.length === 0 && agentTypingIds.size === 0}
			<div class="text-text-muted flex h-full items-center justify-center text-[13px]">
				No messages yet
			</div>
		{/if}
	</div>

	<div class="border-t border-white/[0.06] p-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
		{#if voiceInterim}
			<div class="text-text-muted mb-1.5 px-0.5 text-[11px] leading-snug italic">{voiceInterim}</div>
		{/if}
		<div class="flex gap-1.5">
			{#if sttAvailable}
				<button
					type="button"
					onclick={toggleVoiceToText}
					class="flex h-[38px] w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-all duration-150 active:scale-95
						{voiceBusy
						? 'border-accent/40 bg-accent/15 text-accent'
						: 'border-white/[0.08] bg-white/[0.04] text-text-muted hover:border-white/[0.12] hover:text-text-secondary'}"
					title={voiceBusy
						? 'Stop dictation'
						: 'Voice to text — tap once, speak freely; messages send automatically after pauses'}
					aria-label={voiceBusy ? 'Stop voice input' : 'Start continuous voice to text'}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
						<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
						<line x1="12" x2="12" y1="19" y2="22"/>
					</svg>
				</button>
			{/if}
			<input
				bind:this={inputEl}
				bind:value={inputText}
				placeholder="Type or dictate (chat mic, not call mute)"
				class="bg-white/[0.04] text-text-primary placeholder-text-muted min-w-0 flex-1 rounded-lg border border-white/[0.06] px-3 py-2 text-[13px] outline-none transition-colors focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
				onkeydown={(e) => e.key === 'Enter' && send()}
			/>
			<button
				onclick={send}
				disabled={!inputText.trim()}
				class="bg-accent hover:bg-accent-hover flex-shrink-0 cursor-pointer rounded-lg px-3.5 py-2 text-[12px] font-semibold text-white transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40"
			>
				Send
			</button>
		</div>
	</div>
</div>
