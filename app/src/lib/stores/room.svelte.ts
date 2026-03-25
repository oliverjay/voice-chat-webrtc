import { RoomSocket } from '$lib/room/socket';
import type { Participant, ChatMessage, PreBriefClip, ClipViewStatus, ServerMessage } from '$lib/room/protocol';

class RoomStore {
	participants = $state<Participant[]>([]);
	chatMessages = $state<ChatMessage[]>([]);
	clips = $state<PreBriefClip[]>([]);
	viewStatuses = $state<ClipViewStatus[]>([]);
	myId = $state<string>('');
	connected = $state(false);
	roomId = $state<string>('');
	socket: RoomSocket | null = null;
	private messageListeners = new Set<(msg: ServerMessage) => void>();
	private joinInfo: { name: string; sessionId: string; clientId?: string; audioTrack?: string; videoTrack?: string } | null = null;
	private lobbyInfo: { clientId: string } | null = null;
	private pollInterval: ReturnType<typeof setInterval> | null = null;

	connect(roomServerUrl: string, roomId: string) {
		if (this.socket) {
			this.socket.close();
			this.socket = null;
		}
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}

		this.roomId = roomId;
		this.socket = new RoomSocket(roomServerUrl, roomId);

		this.socket.onMessage((msg) => {
			this.handleMessage(msg);
			for (const listener of this.messageListeners) {
				listener(msg);
			}
		});

		this.socket.onOpen(() => {
			if (this.joinInfo) {
				this.socket?.send({
					type: 'join',
					name: this.joinInfo.name,
					sessionId: this.joinInfo.sessionId,
					clientId: this.joinInfo.clientId,
					audioTrack: this.joinInfo.audioTrack,
					videoTrack: this.joinInfo.videoTrack
				});
			} else if (this.lobbyInfo) {
				this.socket?.send({
					type: 'lobby',
					clientId: this.lobbyInfo.clientId
				});
			}
		});

		this.socket.connect();

		this.pollInterval = setInterval(() => {
			if (this.socket) {
				this.connected = this.socket.connected;
			}
		}, 500);
	}

	disconnect() {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}
		this.connected = false;
	}

	onMessage(listener: (msg: ServerMessage) => void) {
		this.messageListeners.add(listener);
		return () => this.messageListeners.delete(listener);
	}

	lobbyJoin(clientId: string) {
		this.lobbyInfo = { clientId };
		if (this.socket?.connected) {
			this.socket.send({ type: 'lobby', clientId });
		}
	}

	join(name: string, sessionId: string, clientId?: string, audioTrack?: string, videoTrack?: string) {
		this.lobbyInfo = null;
		this.joinInfo = { name, sessionId, clientId, audioTrack, videoTrack };
		if (this.socket?.connected) {
			this.socket.send({ type: 'join', name, sessionId, clientId, audioTrack, videoTrack });
		}
	}

	updateTracks(audioTrack?: string, videoTrack?: string, screenTrack?: string) {
		this.socket?.send({ type: 'track-update', audioTrack, videoTrack, screenTrack });
	}

	sendChat(text: string) {
		const trimmed = String(text).trim().slice(0, 2000);
		if (!trimmed) return;

		const self = this.participants.find((p) => p.id === this.myId);
		const pendingId = `pending-${crypto.randomUUID()}`;
		this.chatMessages = [
			...this.chatMessages,
			{
				id: pendingId,
				participantId: this.myId,
				name: self?.name ?? 'You',
				text: trimmed,
				timestamp: Date.now()
			}
		];

		if (!this.socket?.connected) {
			console.warn('[Room] sendChat: socket not connected — message shown locally only until reconnect');
			return;
		}

		console.log('[Room] sending chat:', trimmed);
		this.socket.send({ type: 'chat', text: trimmed });
	}

	addClip(clip: PreBriefClip) {
		this.socket?.send({ type: 'clip-add', clip });
	}

	deleteClip(clipId: string) {
		this.socket?.send({ type: 'clip-delete', clipId });
	}

	reportClipWatched(clipId: string, clientId: string, participantName: string, progress: number) {
		this.socket?.send({ type: 'clip-watched', clipId, clientId, participantName, progress });
	}

	leave() {
		this.disconnect();
		this.messageListeners.clear();
		this.participants = [];
		this.chatMessages = [];
		this.clips = [];
		this.viewStatuses = [];
		this.myId = '';
		this.joinInfo = null;
		this.lobbyInfo = null;
	}

	get otherParticipants() {
		return this.participants.filter((p) => p.id !== this.myId);
	}

	private handleMessage(msg: ServerMessage) {
		switch (msg.type) {
			case 'snapshot':
				this.participants = msg.participants;
				this.chatMessages = msg.chat;
				this.myId = msg.yourId;
				this.clips = msg.clips || [];
				this.viewStatuses = msg.viewStatus || [];
				this.connected = true;
				break;

			case 'participant-joined':
				this.participants = [...this.participants, msg.participant];
				break;

			case 'participant-left':
				this.participants = this.participants.filter((p) => p.id !== msg.participantId);
				break;

			case 'track-updated': {
				this.participants = this.participants.map((p) =>
					p.id === msg.participantId
						? {
								...p,
								audioTrack: msg.audioTrack ?? p.audioTrack,
								videoTrack: msg.videoTrack ?? p.videoTrack,
								screenTrack: msg.screenTrack ?? p.screenTrack
							}
						: p
				);
				break;
			}

			case 'chat-message': {
				const incoming = msg.message;
				let removedPending = false;
				this.chatMessages = this.chatMessages.filter((m) => {
					if (
						!removedPending &&
						m.id.startsWith('pending-') &&
						m.participantId === incoming.participantId &&
						m.text === incoming.text
					) {
						removedPending = true;
						return false;
					}
					return true;
				});
				this.chatMessages = [...this.chatMessages, incoming];
				console.log('[Room] received chat-message from', incoming.name, ':', incoming.text);
				break;
			}

			case 'clip-added':
				this.clips = [...this.clips, msg.clip];
				break;

			case 'clip-deleted':
				this.clips = this.clips.filter(c => c.id !== msg.clipId);
				this.viewStatuses = this.viewStatuses.filter(v => v.clipId !== msg.clipId);
				break;

			case 'clip-view-updated': {
				const idx = this.viewStatuses.findIndex(
					v => v.clipId === msg.status.clipId && v.clientId === msg.status.clientId
				);
				if (idx >= 0) {
					this.viewStatuses = this.viewStatuses.map((v, i) => i === idx ? msg.status : v);
				} else {
					this.viewStatuses = [...this.viewStatuses, msg.status];
				}
				break;
			}

			case 'agent-joined-ack':
			case 'agent-typing':
			case 'agent-done':
				break;

			case 'error':
				console.error('[Room] Server error:', msg.message);
				break;
		}
	}
}

export const room = new RoomStore();
