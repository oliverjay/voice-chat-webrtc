import type { AgentPersona } from './personas';
import type { RoomSocket } from '$lib/room/socket';
import type { ChatMessage } from '$lib/room/protocol';

export type AgentState = 'idle' | 'thinking' | 'speaking';

interface ActiveAgent {
	persona: AgentPersona;
	participantId: string;
	state: AgentState;
	audioCtx: AudioContext;
	destination: MediaStreamAudioDestinationNode;
	track: MediaStreamTrack;
	trackName: string;
	currentSource: AudioBufferSourceNode | null;
}

export class AgentManager {
	private agents = new Map<string, ActiveAgent>();
	private pc: RTCPeerConnection | null = null;
	private socket: RoomSocket | null = null;
	private onStateChange: ((slug: string, state: AgentState) => void) | null = null;
	private pendingTrackSetup = new Map<string, ActiveAgent>();
	private hostSessionId = '';
	private chatHistoryProvider: (() => ChatMessage[]) | null = null;
	private participantIdsProvider: (() => Set<string>) | null = null;
	private pendingWake: { slug: string; opts?: { lastMessageOverride?: string } } | null = null;
	private responseGeneration = new Map<string, number>();

	setPeerConnection(pc: RTCPeerConnection | null) {
		this.pc = pc;
	}

	setSocket(socket: RoomSocket | null) {
		this.socket = socket;
	}

	setHostSessionId(id: string) {
		this.hostSessionId = id;
	}

	setChatContext(getHistory: () => ChatMessage[], getAgentIds: () => Set<string>) {
		this.chatHistoryProvider = getHistory;
		this.participantIdsProvider = getAgentIds;
	}

	setOnStateChange(cb: (slug: string, state: AgentState) => void) {
		this.onStateChange = cb;
	}

	getAgent(slug: string): ActiveAgent | undefined {
		return this.agents.get(slug);
	}

	getAgentByParticipantId(pid: string): ActiveAgent | undefined {
		for (const agent of this.agents.values()) {
			if (agent.participantId === pid) return agent;
		}
		return undefined;
	}

	get activeAgentSlugs(): Set<string> {
		return new Set(this.agents.keys());
	}

	getAgentState(slug: string): AgentState {
		return this.agents.get(slug)?.state ?? 'idle';
	}

	isAgentParticipant(participantId: string): boolean {
		for (const agent of this.agents.values()) {
			if (agent.participantId === participantId) return true;
		}
		return false;
	}

	async addAgent(persona: AgentPersona): Promise<string | null> {
		if (this.agents.has(persona.slug)) return null;
		if (!this.socket) return null;

		const audioCtx = new AudioContext();
		const destination = audioCtx.createMediaStreamDestination();
		const track = destination.stream.getAudioTracks()[0];
		const trackName = crypto.randomUUID();

		const agent: ActiveAgent = {
			persona,
			participantId: '',
			state: 'idle',
			audioCtx,
			destination,
			track,
			trackName,
			currentSource: null
		};

		this.pendingTrackSetup.set(persona.slug, agent);

		this.socket.send({
			type: 'join',
			name: persona.name,
			sessionId: this.hostSessionId,
			isAgent: true,
			agentSlug: persona.slug,
			avatarUrl: persona.avatarUrl
		} as any);

		return trackName;
	}

	onAgentJoinedAck(participantId: string, slug: string) {
		const agent = this.pendingTrackSetup.get(slug);
		if (!agent) return;

		agent.participantId = participantId;
		this.pendingTrackSetup.delete(slug);
		this.agents.set(slug, agent);
	}

	getTrackForAgent(slug: string): { track: MediaStreamTrack; trackName: string } | null {
		const agent = this.agents.get(slug);
		if (!agent) return null;
		return { track: agent.track, trackName: agent.trackName };
	}

	setAgentParticipantId(slug: string, participantId: string) {
		const agent = this.agents.get(slug) || this.pendingTrackSetup.get(slug);
		if (agent) {
			agent.participantId = participantId;
			if (this.pendingTrackSetup.has(slug)) {
				this.pendingTrackSetup.delete(slug);
				this.agents.set(slug, agent);
			}
		}
	}

	async triggerResponse(
		slug: string,
		chatHistory: ChatMessage[],
		agentParticipantIds: Set<string>,
		greeting = false,
		opts?: { lastMessageOverride?: string }
	): Promise<{ text: string } | null> {
		const agent = this.agents.get(slug);
		if (!agent || !this.socket) return null;

		if (!greeting && agent.state === 'thinking') {
			this.pendingWake = { slug, opts };
			console.warn('[AgentManager] Wake queued — reply still generating:', slug);
			return null;
		}

		if (!greeting && agent.state === 'speaking' && agent.currentSource) {
			try { agent.currentSource.stop(); } catch {}
			agent.currentSource = null;
			this.updateState(slug, 'idle');
		}

		const gen = (this.responseGeneration.get(slug) ?? 0) + 1;
		this.responseGeneration.set(slug, gen);

		this.updateState(slug, 'thinking');

		this.socket.send({
			type: 'agent-typing',
			participantId: agent.participantId
		} as any);

		try {
			let messages:
				| Array<{ name: string; text: string; isAgent: boolean }>
				| undefined;
			if (!greeting) {
				const rows = mergeConsecutiveChatRows(
					chatHistory.slice(-30).map((m) => ({
						participantId: m.participantId,
						name: m.name,
						text: m.text,
						isAgent: agentParticipantIds.has(m.participantId)
					}))
				);
				if (opts?.lastMessageOverride !== undefined && rows.length > 0) {
					const lastHumanIdx = findLastHumanIndex(rows);
					if (lastHumanIdx >= 0) {
						const o = opts.lastMessageOverride;
						messages = rows.map((r, j) =>
							j === lastHumanIdx ? { name: r.name, text: o, isAgent: r.isAgent } : r
						);
					} else {
						messages = rows;
					}
				} else {
					messages = rows;
				}
			}

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 30_000);

			let res: Response;
			try {
				res = await fetch('/api/agent/respond', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ slug, messages, greeting }),
					signal: controller.signal
				});
			} finally {
				clearTimeout(timeout);
			}

			if (this.responseGeneration.get(slug) !== gen) return null;

			if (!res.ok) {
				const body = await res.text().catch(() => '');
				console.error('[AgentManager] API error:', res.status, body.slice(0, 200));
				this.sendAgentDone(agent);
				this.updateState(slug, 'idle');
				return null;
			}

			const data = await res.json();
			const { text, audio } = data;

			if (!text) {
				console.warn('[AgentManager] Empty response from API');
				this.sendAgentDone(agent);
				this.updateState(slug, 'idle');
				return null;
			}

			this.socket.send({
				type: 'chat-as-agent',
				participantId: agent.participantId,
				text
			} as any);

			this.sendAgentDone(agent);

			if (audio) {
				await this.playAudio(slug, audio);
			} else {
				this.updateState(slug, 'idle');
			}

			return { text };
		} catch (e: any) {
			if (e.name === 'AbortError') {
				console.error('[AgentManager] Response timed out for:', slug);
			} else {
				console.error('[AgentManager] Response failed:', e);
			}
			this.sendAgentDone(agent);
			this.updateState(slug, 'idle');
			return null;
		} finally {
			if (this.responseGeneration.get(slug) === gen) {
				this.flushPendingWake();
			}
		}
	}

	private sendAgentDone(agent: ActiveAgent) {
		this.socket?.send({
			type: 'agent-done',
			participantId: agent.participantId
		} as any);
	}

	private flushPendingWake() {
		const p = this.pendingWake;
		this.pendingWake = null;
		const getH = this.chatHistoryProvider;
		const getIds = this.participantIdsProvider;
		if (!p || !getH || !getIds) return;
		queueMicrotask(() => {
			void this.triggerResponse(p.slug, getH(), getIds(), false, p.opts);
		});
	}

	private async playAudio(slug: string, audioBase64: string): Promise<void> {
		const agent = this.agents.get(slug);
		if (!agent) return;

		if (agent.currentSource) {
			try { agent.currentSource.stop(); } catch {}
			agent.currentSource = null;
		}

		try {
			if (agent.audioCtx.state === 'suspended') {
				await agent.audioCtx.resume();
			}

			const binaryStr = atob(audioBase64);
			const bytes = new Uint8Array(binaryStr.length);
			for (let i = 0; i < binaryStr.length; i++) {
				bytes[i] = binaryStr.charCodeAt(i);
			}

			const audioBuffer = await agent.audioCtx.decodeAudioData(bytes.buffer.slice(0));
			const source = agent.audioCtx.createBufferSource();
			source.buffer = audioBuffer;
			source.connect(agent.destination);

			this.updateState(slug, 'speaking');

			return new Promise((resolve) => {
				source.onended = () => {
					agent.currentSource = null;
					this.updateState(slug, 'idle');
					resolve();
				};
				agent.currentSource = source;
				source.start();
			});
		} catch (e) {
			console.error('[AgentManager] playAudio failed:', e);
			this.updateState(slug, 'idle');
		}
	}

	removeAgent(slug: string) {
		const agent = this.agents.get(slug);
		if (!agent) return;

		if (agent.currentSource) {
			try { agent.currentSource.stop(); } catch {}
		}

		if (this.socket) {
			this.socket.send({
				type: 'leave-agent',
				participantId: agent.participantId
			} as any);
		}

		agent.audioCtx.close().catch(() => {});
		this.agents.delete(slug);
		this.responseGeneration.delete(slug);
	}

	private updateState(slug: string, state: AgentState) {
		const agent = this.agents.get(slug);
		if (agent) {
			agent.state = state;
			this.onStateChange?.(slug, state);
		}
	}

	cleanup() {
		this.pendingWake = null;
		this.chatHistoryProvider = null;
		this.participantIdsProvider = null;
		this.responseGeneration.clear();
		for (const [slug] of this.agents) {
			this.removeAgent(slug);
		}
		this.pendingTrackSetup.clear();
	}
}

type ChatRow = {
	participantId: string;
	name: string;
	text: string;
	isAgent: boolean;
};

function findLastHumanIndex(rows: Array<{ name: string; text: string; isAgent: boolean }>): number {
	for (let i = rows.length - 1; i >= 0; i--) {
		if (!rows[i].isAgent) return i;
	}
	return -1;
}

/** Joins consecutive lines from the same human so pauses mid-thought don't split context. */
function mergeConsecutiveChatRows(rows: ChatRow[]): Array<{ name: string; text: string; isAgent: boolean }> {
	const acc: ChatRow[] = [];
	for (const r of rows) {
		const prev = acc[acc.length - 1];
		if (!r.isAgent && prev && !prev.isAgent && prev.participantId === r.participantId) {
			prev.text = `${prev.text.trim()}\n${r.text.trim()}`;
		} else {
			acc.push({ ...r });
		}
	}
	return acc.map(({ name, text, isAgent }) => ({ name, text, isAgent }));
}
