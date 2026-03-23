export { Room } from './room';

interface Env {
	ROOMS: DurableObjectNamespace;
}

function corsHeaders(request: Request): HeadersInit {
	const origin = request.headers.get('Origin') || '*';
	return {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Protocol',
		'Access-Control-Max-Age': '86400'
	};
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders(request) });
		}

		const url = new URL(request.url);
		const match = url.pathname.match(/^\/room\/([a-z0-9-]+)$/);

		if (!match) {
			return new Response('Not found', { status: 404, headers: corsHeaders(request) });
		}

		const roomId = match[1];
		const id = env.ROOMS.idFromName(roomId);
		const stub = env.ROOMS.get(id);

		if (request.headers.get('Upgrade') === 'websocket') {
			return stub.fetch(request);
		}

		return new Response('WebSocket upgrade required', {
			status: 426,
			headers: corsHeaders(request)
		});
	}
} satisfies ExportedHandler<Env>;
