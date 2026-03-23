export interface Participant {
	id: string;
	name: string;
	sessionId: string;
	clientId?: string;
	audioTrack?: string;
	videoTrack?: string;
	screenTrack?: string;
}

export interface ChatMessage {
	id: string;
	participantId: string;
	name: string;
	text: string;
	timestamp: number;
}

// Client -> Server
export type ClientMessage =
	| { type: 'join'; name: string; sessionId: string; clientId?: string; audioTrack?: string; videoTrack?: string }
	| { type: 'leave' }
	| { type: 'track-update'; audioTrack?: string; videoTrack?: string; screenTrack?: string }
	| { type: 'chat'; text: string }
	| { type: 'heartbeat' }
	| { type: 'peek' };

// Server -> Client
export type ServerMessage =
	| { type: 'snapshot'; participants: Participant[]; chat: ChatMessage[]; yourId: string }
	| { type: 'participant-joined'; participant: Participant }
	| { type: 'participant-left'; participantId: string }
	| { type: 'track-updated'; participantId: string; audioTrack?: string; videoTrack?: string; screenTrack?: string }
	| { type: 'chat-message'; message: ChatMessage }
	| { type: 'peek-result'; participants: Array<{ name: string }> }
	| { type: 'error'; message: string };
