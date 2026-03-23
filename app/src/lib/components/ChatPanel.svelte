<script lang="ts">
	import type { ChatMessage } from '$lib/room/protocol';

	let {
		open = false,
		messages = [],
		myId = '',
		onSend,
		onClose
	}: {
		open?: boolean;
		messages?: ChatMessage[];
		myId?: string;
		onSend: (text: string) => void;
		onClose: () => void;
	} = $props();

	let inputText = $state('');
	let messagesEl: HTMLDivElement;
	let inputEl: HTMLInputElement;

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
			<div class={msg.participantId === myId ? 'text-right' : ''}>
				<div class="text-text-muted text-[11px] mb-0.5 font-medium">{msg.name}</div>
				<div class="inline-block max-w-[85%] rounded-xl px-3 py-1.5 text-[13px] leading-relaxed {msg.participantId === myId
					? 'bg-accent/15 text-text-primary'
					: 'bg-white/[0.04] text-text-primary'}">
					{msg.text}
				</div>
			</div>
		{/each}
		{#if messages.length === 0}
			<div class="text-text-muted flex h-full items-center justify-center text-[13px]">
				No messages yet
			</div>
		{/if}
	</div>

	<div class="border-t border-white/[0.06] p-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
		<div class="flex gap-1.5">
			<input
				bind:this={inputEl}
				bind:value={inputText}
				placeholder="Type a message..."
				class="bg-white/[0.04] text-text-primary placeholder-text-muted flex-1 rounded-lg border border-white/[0.06] px-3 py-2 text-[13px] outline-none transition-colors focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
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
