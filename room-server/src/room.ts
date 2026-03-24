interface Participant {
	id: string;
	name: string;
	sessionId: string;
	clientId?: string;
	audioTrack?: string;
	videoTrack?: string;
	screenTrack?: string;
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

const MAX_CHAT_HISTORY = 50;
const DISCONNECT_GRACE_MS = 2000;

export class Room implements DurableObject {
	private participants = new Map<string, Participant>();
	private connections = new Map<WebSocket, string>();
	private chat: ChatMessage[] = [];
	private disconnectTimers = new Map<string, number>();
	private clips: PreBriefClip[] = [];
	private viewStatuses: ClipViewStatus[] = [];
	private clipsLoaded = false;

	constructor(
		private ctx: DurableObjectState,
		private env: Env
	) {}

	private async loadClips() {
		if (this.clipsLoaded) return;
		const stored = await this.ctx.storage.get<PreBriefClip[]>('clips');
		this.clips = stored || [];
		const views = await this.ctx.storage.get<ClipViewStatus[]>('viewStatuses');
		this.viewStatuses = views || [];
		this.clipsLoaded = true;
	}

	private async saveClips() {
		await this.ctx.storage.put('clips', this.clips);
	}

	private async saveViewStatuses() {
		await this.ctx.storage.put('viewStatuses', this.viewStatuses);
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected WebSocket', { status: 400 });
		}

		await this.loadClips();

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
		const participantId = this.connections.get(ws);
		if (!participantId) return;

		this.connections.delete(ws);

		const timer = setTimeout(() => {
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

				let existingId: string | null = null;
				if (clientId) {
					for (const [pid, p] of this.participants) {
						if (p.clientId && p.clientId === clientId) {
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
					existing.clientId = clientId;
					existing.audioTrack = msg.audioTrack;
					existing.videoTrack = msg.videoTrack;
					existing.screenTrack = undefined;

					this.connections.set(ws, existingId);

					this.send(ws, {
						type: 'snapshot',
						participants: Array.from(this.participants.values()),
						chat: this.chat.slice(-MAX_CHAT_HISTORY),
						yourId: existingId,
						clips: this.clips,
						viewStatus: this.viewStatuses
					});

					this.broadcast({
						type: 'track-updated',
						participantId: existingId,
						audioTrack: existing.audioTrack,
						videoTrack: existing.videoTrack,
						screenTrack: existing.screenTrack
					}, ws);
				} else {
					const id = crypto.randomUUID();

					const participant: Participant = {
						id,
						name,
						sessionId: cfSessionId,
						clientId,
						audioTrack: msg.audioTrack,
						videoTrack: msg.videoTrack
					};

					this.participants.set(id, participant);
					this.connections.set(ws, id);

					this.send(ws, {
						type: 'snapshot',
						participants: Array.from(this.participants.values()),
						chat: this.chat.slice(-MAX_CHAT_HISTORY),
						yourId: id,
						clips: this.clips,
						viewStatus: this.viewStatuses
					});

					this.broadcast(
						{ type: 'participant-joined', participant },
						ws
					);
				}
				break;
			}

			case 'leave': {
				const pid = this.connections.get(ws);
				if (pid) {
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

				console.log('[Room] broadcasting chat from', p.name, 'to', this.ctx.getWebSockets().length, 'sockets');
				this.broadcast({ type: 'chat-message', message: chatMsg });
				break;
			}

			case 'heartbeat':
				break;

			case 'peek': {
				const names = Array.from(this.participants.values()).map(p => ({ name: p.name }));
				this.send(ws, { type: 'peek-result', participants: names, clipCount: this.clips.length });
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
		}
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
