import { RoomSocket } from '$lib/room/socket';
import type { Participant, ChatMessage, ServerMessage } from '$lib/room/protocol';

class RoomStore {
	participants = $state<Participant[]>([]);
	chatMessages = $state<ChatMessage[]>([]);
	myId = $state<string>('');
	connected = $state(false);
	roomId = $state<string>('');
	socket: RoomSocket | null = null;
	private messageListeners = new Set<(msg: ServerMessage) => void>();
	private joinInfo: { name: string; sessionId: string; clientId?: string; audioTrack?: string; videoTrack?: string } | null = null;

	connect(roomServerUrl: string, roomId: string) {
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
			}
		});

		this.socket.connect();

		const checkConnected = setInterval(() => {
			if (this.socket) {
				this.connected = this.socket.connected;
			}
		}, 500);

		return () => {
			clearInterval(checkConnected);
		};
	}

	onMessage(listener: (msg: ServerMessage) => void) {
		this.messageListeners.add(listener);
		return () => this.messageListeners.delete(listener);
	}

	join(name: string, sessionId: string, clientId?: string, audioTrack?: string, videoTrack?: string) {
		this.joinInfo = { name, sessionId, clientId, audioTrack, videoTrack };
		if (this.socket?.connected) {
			this.socket.send({ type: 'join', name, sessionId, clientId, audioTrack, videoTrack });
		}
	}

	updateTracks(audioTrack?: string, videoTrack?: string, screenTrack?: string) {
		this.socket?.send({ type: 'track-update', audioTrack, videoTrack, screenTrack });
	}

	sendChat(text: string) {
		if (!this.socket?.connected) {
			console.warn('[Room] sendChat failed: socket not connected');
			return;
		}
		console.log('[Room] sending chat:', text);
		this.socket.send({ type: 'chat', text });
	}

	leave() {
		this.socket?.disconnect();
		this.socket = null;
		this.participants = [];
		this.chatMessages = [];
		this.myId = '';
		this.connected = false;
		this.joinInfo = null;
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

			case 'chat-message':
				console.log('[Room] received chat-message from', msg.message.name, ':', msg.message.text);
				this.chatMessages = [...this.chatMessages, msg.message];
				break;

			case 'error':
				console.error('[Room] Server error:', msg.message);
				break;
		}
	}
}

export const room = new RoomStore();
