interface Participant {
	id: string;
	name: string;
	sessionId: string;
	clientId?: string;
	audioTrack?: string;
	videoTrack?: string;
	screenTrack?: string;
	isAgent?: boolean;
	agentSlug?: string;
	avatarUrl?: string;
	hostWs?: WebSocket;
}

interface ChatMessage {
	id: string;
	participantId: string;
	name: string;
	text: string;
	timestamp: number;
}

interface PreBriefClip {
	id: string;
	roomId: string;
	authorId: string;
	authorName: string;
	title: string;
	duration: number;
	mediaUrl: string;
	mediaType: 'video' | 'audio';
	createdAt: string;
	order: number;
}

interface ClipViewStatus {
	clipId: string;
	clientId: string;
	participantName: string;
	watched: boolean;
	progress: number;
	watchedAt: string | null;
}

interface Env {}

/** Keep a long transcript for reconnects and late joiners (trimmed if memory grows). */
const MAX_CHAT_HISTORY = 500;
const DISCONNECT_GRACE_MS = 5000;

export class Room implements DurableObject {
	private participants = new Map<string, Participant>();
	private connections = new Map<WebSocket, string>();
	private chat: ChatMessage[] = [];
	private disconnectTimers = new Map<string, number>();
	private clips: PreBriefClip[] = [];
	private viewStatuses: ClipViewStatus[] = [];
	private activeAgentSlugs = new Set<string>();
	private stateLoaded = false;

	constructor(
		private ctx: DurableObjectState,
		private env: Env
	) {}

	private async loadState() {
		if (this.stateLoaded) return;
		const stored = await this.ctx.storage.get<PreBriefClip[]>('clips');
		this.clips = stored || [];
		const views = await this.ctx.storage.get<ClipViewStatus[]>('viewStatuses');
		this.viewStatuses = views || [];
		const chatStored = await this.ctx.storage.get<ChatMessage[]>('chat');
		this.chat = chatStored || [];
		const slugsStored = await this.ctx.storage.get<string[]>('agentSlugs');
		this.activeAgentSlugs = new Set(slugsStored || []);
		this.stateLoaded = true;
	}

	private async saveClips() {
		await this.ctx.storage.put('clips', this.clips);
	}

	private async saveChat() {
		await this.ctx.storage.put('chat', this.chat);
	}

	private async saveAgentSlugs() {
		await this.ctx.storage.put('agentSlugs', [...this.activeAgentSlugs]);
	}

	private async saveViewStatuses() {
		await this.ctx.storage.put('viewStatuses', this.viewStatuses);
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected WebSocket', { status: 400 });
		}

		await this.loadState();

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		this.ctx.acceptWebSocket(server);

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
		try {
			const msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
			await this.handleMessage(ws, msg);
		} catch (e) {
			this.send(ws, { type: 'error', message: 'Invalid message' });
		}
	}

	async webSocketClose(ws: WebSocket) {
		for (const [pid, p] of this.participants) {
			if (p.isAgent && p.hostWs === ws) {
				console.log('[Room] Removing agent', p.name, 'because host disconnected');
				this.removeParticipant(pid);
			}
		}

		const participantId = this.connections.get(ws);
		if (!participantId) {
			console.log('[Room] webSocketClose for untracked socket (lobby/peek)');
			return;
		}

		const p = this.participants.get(participantId);
		console.log('[Room] webSocketClose for', p?.name || participantId, '- starting grace timer');
		this.connections.delete(ws);

		const timer = setTimeout(() => {
			console.log('[Room] Grace expired for', p?.name || participantId, '- removing');
			this.removeParticipant(participantId);
		}, DISCONNECT_GRACE_MS) as unknown as number;

		this.disconnectTimers.set(participantId, timer);
	}

	async webSocketError(ws: WebSocket) {
		await this.webSocketClose(ws);
	}

	private async handleMessage(ws: WebSocket, msg: any) {
		switch (msg.type) {
		case 'join': {
			this.cleanupStaleConnections();

			const name = String(msg.name || 'Anonymous').slice(0, 50);
			const cfSessionId = String(msg.sessionId || '');
			const clientId = msg.clientId ? String(msg.clientId) : '';
			const isAgent = !!msg.isAgent;
			console.log('[Room] join:', name, 'isAgent:', isAgent, 'clientId:', clientId?.slice(0, 8), 'session:', cfSessionId?.slice(0, 8), 'participants:', this.participants.size);

			let existingId: string | null = null;
				if (clientId && !isAgent) {
					for (const [pid, p] of this.participants) {
						if (p.clientId && p.clientId === clientId) {
							existingId = pid;
							break;
						}
					}
				}
				// Reuse existing agent participant with same slug
				if (isAgent && msg.agentSlug) {
					for (const [pid, p] of this.participants) {
						if (p.isAgent && p.agentSlug === msg.agentSlug) {
							existingId = pid;
							break;
						}
					}
				}

				if (existingId) {
					const timer = this.disconnectTimers.get(existingId);
					if (timer) {
						clearTimeout(timer);
						this.disconnectTimers.delete(existingId);
					}

					for (const [oldWs, oldPid] of this.connections) {
						if (oldPid === existingId && oldWs !== ws) {
							this.connections.delete(oldWs);
							try { oldWs.close(1000, 'Replaced'); } catch {}
						}
					}

				const existing = this.participants.get(existingId)!;
				existing.name = name;
				existing.sessionId = cfSessionId;
				existing.audioTrack = msg.audioTrack;
				existing.videoTrack = msg.videoTrack;
				existing.screenTrack = undefined;

				if (existing.isAgent) {
					existing.hostWs = ws;
					existing.audioTrack = undefined;
					existing.videoTrack = undefined;
					existing.screenTrack = undefined;
					this.send(ws, {
						type: 'agent-joined-ack',
						participantId: existingId,
						agentSlug: existing.agentSlug
					});
				} else {
					existing.clientId = clientId;
					this.connections.set(ws, existingId);
					this.send(ws, {
						type: 'snapshot',
						participants: this.sanitizedParticipants(),
						chat: this.chat.slice(-MAX_CHAT_HISTORY),
						yourId: existingId,
						clips: this.clips,
						viewStatus: this.viewStatuses,
						activeAgentSlugs: [...this.activeAgentSlugs]
					});
					this.broadcast({
						type: 'track-updated',
						participantId: existingId,
						audioTrack: existing.audioTrack,
						videoTrack: existing.videoTrack,
						screenTrack: existing.screenTrack
					}, ws);
				}
			} else {
				const id = crypto.randomUUID();
				const avatarUrl = msg.avatarUrl ? String(msg.avatarUrl) : undefined;

				const agentSlug = isAgent && msg.agentSlug ? String(msg.agentSlug) : undefined;

				const participant: Participant = {
					id,
					name,
					sessionId: cfSessionId,
					clientId,
					audioTrack: msg.audioTrack,
					videoTrack: msg.videoTrack,
					isAgent,
					agentSlug,
					avatarUrl,
					hostWs: isAgent ? ws : undefined
				};

				this.participants.set(id, participant);
				if (!isAgent) {
					this.connections.set(ws, id);
				}

				if (isAgent && agentSlug) {
					this.activeAgentSlugs.add(agentSlug);
					await this.saveAgentSlugs();
				}

				const broadcastParticipant = { ...participant, hostWs: undefined };

				if (!isAgent) {
					this.send(ws, {
						type: 'snapshot',
						participants: this.sanitizedParticipants(),
						chat: this.chat.slice(-MAX_CHAT_HISTORY),
						yourId: id,
						clips: this.clips,
						viewStatus: this.viewStatuses,
						activeAgentSlugs: [...this.activeAgentSlugs]
					});
				} else {
					this.send(ws, {
						type: 'agent-joined-ack',
						participantId: id,
						agentSlug
					});
				}

				this.broadcast(
					{ type: 'participant-joined', participant: broadcastParticipant },
					isAgent ? undefined : ws
				);
			}
			break;
		}

		case 'leave': {
			const pid = this.connections.get(ws);
			if (pid) {
				const p = this.participants.get(pid);
				console.log('[Room] leave from', p?.name || pid, '- removing immediately');
				this.connections.delete(ws);
				this.removeParticipant(pid);
			}
			try { ws.close(1000, 'Left'); } catch {}
			break;
		}

			case 'track-update': {
				const pid = this.connections.get(ws);
				if (!pid) return;
				const p = this.participants.get(pid);
				if (!p) return;

				if (msg.audioTrack !== undefined) p.audioTrack = msg.audioTrack;
				if (msg.videoTrack !== undefined) p.videoTrack = msg.videoTrack;
				if (msg.screenTrack !== undefined) p.screenTrack = msg.screenTrack || undefined;

				this.broadcast({
					type: 'track-updated',
					participantId: pid,
					audioTrack: p.audioTrack,
					videoTrack: p.videoTrack,
					screenTrack: p.screenTrack
				});
				break;
			}

			case 'chat': {
				const pid = this.connections.get(ws);
				if (!pid) {
					console.log('[Room] chat dropped: ws not in connections map. connections size:', this.connections.size);
					return;
				}
				const p = this.participants.get(pid);
				if (!p) {
					console.log('[Room] chat dropped: participant not found for pid:', pid);
					return;
				}

				const text = String(msg.text || '').trim().slice(0, 2000);
				if (!text) return;

				const chatMsg: ChatMessage = {
					id: crypto.randomUUID(),
					participantId: pid,
					name: p.name,
					text,
					timestamp: Date.now()
				};

				this.chat.push(chatMsg);
				if (this.chat.length > MAX_CHAT_HISTORY * 2) {
					this.chat = this.chat.slice(-MAX_CHAT_HISTORY);
				}
				await this.saveChat();

				console.log('[Room] broadcasting chat from', p.name, 'to', this.ctx.getWebSockets().length, 'sockets');
				this.broadcast({ type: 'chat-message', message: chatMsg });
				break;
			}

			case 'heartbeat':
				break;

		case 'peek': {
			const peeked = Array.from(this.participants.values())
				.filter(p => p.sessionId)
				.map(p => ({ name: p.name, isAgent: p.isAgent || false, avatarUrl: p.avatarUrl || '' }));
			this.send(ws, { type: 'peek-result', participants: peeked, clipCount: this.clips.length });
			break;
		}

	case 'lobby': {
		const clientId = msg.clientId ? String(msg.clientId) : '';
		this.send(ws, {
			type: 'snapshot',
			participants: this.sanitizedParticipants().filter(p => p.sessionId),
			chat: [],
			yourId: '',
			clips: this.clips,
			viewStatus: this.viewStatuses
		});
		break;
	}

			case 'clip-add': {
				const pid = this.connections.get(ws);
				if (!pid) return;
				const clip = msg.clip as PreBriefClip;
				if (!clip?.id) return;
				clip.order = this.clips.length;
				this.clips.push(clip);
				await this.saveClips();
				this.broadcast({ type: 'clip-added', clip });
				break;
			}

			case 'clip-delete': {
				const pid = this.connections.get(ws);
				if (!pid) return;
				const clipId = msg.clipId as string;
				this.clips = this.clips.filter(c => c.id !== clipId);
				this.viewStatuses = this.viewStatuses.filter(v => v.clipId !== clipId);
				await this.saveClips();
				await this.saveViewStatuses();
				this.broadcast({ type: 'clip-deleted', clipId });
				break;
			}

			case 'clip-watched': {
				const clientId = msg.clientId as string;
				const clipId = msg.clipId as string;
				const participantName = msg.participantName as string;
				const progress = Math.min(1, Math.max(0, Number(msg.progress) || 0));
				if (!clientId || !clipId) return;

				const existing = this.viewStatuses.find(v => v.clipId === clipId && v.clientId === clientId);
				const watched = progress >= 0.9;
				if (existing) {
					existing.progress = Math.max(existing.progress, progress);
					existing.watched = existing.watched || watched;
					existing.participantName = participantName;
					if (watched && !existing.watchedAt) existing.watchedAt = new Date().toISOString();
				} else {
					this.viewStatuses.push({
						clipId,
						clientId,
						participantName,
						watched,
						progress,
						watchedAt: watched ? new Date().toISOString() : null
					});
				}
				await this.saveViewStatuses();

				const status = existing || this.viewStatuses[this.viewStatuses.length - 1];
				this.broadcast({ type: 'clip-view-updated', status });
				break;
			}

			case 'leave-agent': {
				const agentPid = msg.participantId as string;
				if (!agentPid) return;
				const agent = this.participants.get(agentPid);
				if (!agent?.isAgent || agent.hostWs !== ws) return;
				if (agent.agentSlug) {
					this.activeAgentSlugs.delete(agent.agentSlug);
					await this.saveAgentSlugs();
				}
				this.removeParticipant(agentPid);
				break;
			}

			case 'track-update-agent': {
				const agentPid = msg.participantId as string;
				if (!agentPid) return;
				const agent = this.participants.get(agentPid);
				if (!agent?.isAgent || agent.hostWs !== ws) return;
				if (msg.audioTrack !== undefined) agent.audioTrack = msg.audioTrack;
				if (msg.sessionId) agent.sessionId = String(msg.sessionId);
				this.broadcast({
					type: 'track-updated',
					participantId: agentPid,
					audioTrack: agent.audioTrack,
					videoTrack: agent.videoTrack,
					screenTrack: agent.screenTrack
				});
				break;
			}

			case 'chat-as-agent': {
				const agentPid = msg.participantId as string;
				if (!agentPid) return;
				const agent = this.participants.get(agentPid);
				if (!agent?.isAgent || agent.hostWs !== ws) return;
				const text = String(msg.text || '').trim().slice(0, 2000);
				if (!text) return;
				const chatMsg: ChatMessage = {
					id: crypto.randomUUID(),
					participantId: agentPid,
					name: agent.name,
					text,
					timestamp: Date.now()
				};
				this.chat.push(chatMsg);
				if (this.chat.length > MAX_CHAT_HISTORY * 2) {
					this.chat = this.chat.slice(-MAX_CHAT_HISTORY);
				}
				this.broadcast({ type: 'chat-message', message: chatMsg });
				break;
			}

			case 'agent-typing': {
				const agentPid = msg.participantId as string;
				if (!agentPid) return;
				const agent = this.participants.get(agentPid);
				if (!agent?.isAgent || agent.hostWs !== ws) return;
				this.broadcast({ type: 'agent-typing', participantId: agentPid });
				break;
			}

			case 'agent-done': {
				const agentPid = msg.participantId as string;
				if (!agentPid) return;
				const agent = this.participants.get(agentPid);
				if (!agent?.isAgent || agent.hostWs !== ws) return;
				this.broadcast({ type: 'agent-done', participantId: agentPid });
				break;
			}
		}
	}

	private sanitizedParticipants() {
		return Array.from(this.participants.values()).map(({ hostWs, ...rest }) => rest);
	}

	private removeParticipant(id: string) {
		this.participants.delete(id);
		this.disconnectTimers.delete(id);
		this.broadcast({ type: 'participant-left', participantId: id });
	}

	private cleanupStaleConnections() {
		const liveSockets = new Set(this.ctx.getWebSockets());
		const staleParticipantIds = new Set<string>();

		for (const [ws, pid] of this.connections) {
			if (!liveSockets.has(ws)) {
				this.connections.delete(ws);
				staleParticipantIds.add(pid);
			}
		}

		const connectedPids = new Set(this.connections.values());
		for (const pid of staleParticipantIds) {
			if (!connectedPids.has(pid) && !this.disconnectTimers.has(pid)) {
				this.removeParticipant(pid);
			}
		}
	}

	private broadcast(msg: any, exclude?: WebSocket) {
		const data = JSON.stringify(msg);
		for (const ws of this.ctx.getWebSockets()) {
			if (ws !== exclude) {
				try { ws.send(data); } catch {}
			}
		}
	}

	private send(ws: WebSocket, msg: any) {
		try { ws.send(JSON.stringify(msg)); } catch {}
	}
}
