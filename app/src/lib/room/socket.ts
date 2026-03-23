import type { ClientMessage, ServerMessage } from './protocol';

export type MessageHandler = (msg: ServerMessage) => void;
export type OpenHandler = () => void;

export class RoomSocket {
	private ws: WebSocket | null = null;
	private handlers = new Set<MessageHandler>();
	private openHandlers = new Set<OpenHandler>();
	private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 5;
	private _connected = false;

	constructor(
		private url: string,
		private roomId: string
	) {}

	get connected() {
		return this._connected;
	}

	connect() {
		if (this.ws) this.disconnect();

		const wsUrl = `${this.url}/room/${this.roomId}`;
		console.log('[RoomSocket] connecting to', wsUrl);
		this.ws = new WebSocket(wsUrl);

		this.ws.onopen = () => {
			console.log('[RoomSocket] connected');
			this._connected = true;
			this.reconnectAttempts = 0;
			this.startHeartbeat();
			for (const handler of this.openHandlers) {
				handler();
			}
		};

		this.ws.onmessage = (e) => {
			try {
				const msg: ServerMessage = JSON.parse(e.data);
				for (const handler of this.handlers) {
					handler(msg);
				}
			} catch (err) {
				console.error('[RoomSocket] parse error:', err);
			}
		};

		this.ws.onclose = () => {
			console.log('[RoomSocket] disconnected');
			this._connected = false;
			this.stopHeartbeat();
			this.tryReconnect();
		};

		this.ws.onerror = (e) => {
			console.error('[RoomSocket] error:', e);
		};
	}

	send(msg: ClientMessage) {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		}
	}

	onMessage(handler: MessageHandler) {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	onOpen(handler: OpenHandler) {
		this.openHandlers.add(handler);
		return () => this.openHandlers.delete(handler);
	}

	disconnect() {
		this._connected = false;
		this.stopHeartbeat();
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}
		if (this.ws) {
			this.ws.onclose = null;
			this.ws.onerror = null;
			try {
				this.send({ type: 'leave' });
				this.ws.close(1000);
			} catch {}
			this.ws = null;
		}
	}

	private startHeartbeat() {
		this.heartbeatInterval = setInterval(() => {
			this.send({ type: 'heartbeat' });
		}, 15000);
	}

	private stopHeartbeat() {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
	}

	private tryReconnect() {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.log('[RoomSocket] max reconnect attempts reached');
			return;
		}
		const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
		this.reconnectAttempts++;
		console.log(`[RoomSocket] reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
		this.reconnectTimeout = setTimeout(() => this.connect(), delay);
	}
}
