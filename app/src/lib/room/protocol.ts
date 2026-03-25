export interface Participant {
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
}

export interface ChatMessage {
	id: string;
	participantId: string;
	name: string;
	text: string;
	timestamp: number;
}

export interface PreBriefClip {
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

export interface ClipViewStatus {
	clipId: string;
	clientId: string;
	participantName: string;
	watched: boolean;
	progress: number;
	watchedAt: string | null;
}

// Client -> Server
export type ClientMessage =
	| { type: 'join'; name: string; sessionId: string; clientId?: string; audioTrack?: string; videoTrack?: string; isAgent?: boolean; avatarUrl?: string }
	| { type: 'leave' }
	| { type: 'leave-agent'; participantId: string }
	| { type: 'track-update'; audioTrack?: string; videoTrack?: string; screenTrack?: string }
	| { type: 'track-update-agent'; participantId: string; audioTrack?: string; sessionId?: string }
	| { type: 'chat'; text: string }
	| { type: 'chat-as-agent'; participantId: string; text: string }
	| { type: 'agent-typing'; participantId: string }
	| { type: 'agent-done'; participantId: string }
	| { type: 'heartbeat' }
	| { type: 'peek' }
	| { type: 'clip-add'; clip: PreBriefClip }
	| { type: 'clip-delete'; clipId: string }
	| { type: 'clip-watched'; clipId: string; clientId: string; participantName: string; progress: number };

// Server -> Client
export type ServerMessage =
	| { type: 'snapshot'; participants: Participant[]; chat: ChatMessage[]; yourId: string; clips?: PreBriefClip[]; viewStatus?: ClipViewStatus[]; activeAgentSlugs?: string[] }
	| { type: 'participant-joined'; participant: Participant }
	| { type: 'participant-left'; participantId: string }
	| { type: 'track-updated'; participantId: string; audioTrack?: string; videoTrack?: string; screenTrack?: string }
	| { type: 'chat-message'; message: ChatMessage }
	| { type: 'agent-joined-ack'; participantId: string; agentSlug?: string }
	| { type: 'agent-typing'; participantId: string }
	| { type: 'agent-done'; participantId: string }
	| { type: 'clip-added'; clip: PreBriefClip }
	| { type: 'clip-deleted'; clipId: string }
	| { type: 'clip-view-updated'; status: ClipViewStatus }
	| { type: 'peek-result'; participants: Array<{ name: string }>; clipCount: number }
	| { type: 'error'; message: string };
