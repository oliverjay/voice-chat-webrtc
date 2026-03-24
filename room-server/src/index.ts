export { Room } from './room';

interface Env {
	ROOMS: DurableObjectNamespace;
	CLIPS_BUCKET: R2Bucket;
}

function corsHeaders(request: Request): HeadersInit {
	const origin = request.headers.get('Origin') || '*';
	return {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

		const roomMatch = url.pathname.match(/^\/room\/([a-z0-9-]+)$/);
		if (roomMatch) {
			const roomId = roomMatch[1];
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

		const clipUploadMatch = url.pathname.match(/^\/clips\/([a-z0-9-]+)\/upload$/);
		if (clipUploadMatch && request.method === 'PUT') {
			const roomId = clipUploadMatch[1];
			const clipId = url.searchParams.get('clipId');
			const contentType = request.headers.get('Content-Type') || 'video/webm';
			if (!clipId) {
				return new Response('Missing clipId', { status: 400, headers: corsHeaders(request) });
			}
			const key = `${roomId}/${clipId}`;
			await env.CLIPS_BUCKET.put(key, request.body, {
				httpMetadata: { contentType }
			});
			return new Response(JSON.stringify({ ok: true, key }), {
				headers: { ...corsHeaders(request), 'Content-Type': 'application/json' }
			});
		}

		const clipGetMatch = url.pathname.match(/^\/clips\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
		if (clipGetMatch && request.method === 'GET') {
			const roomId = clipGetMatch[1];
			const clipId = clipGetMatch[2];
			const key = `${roomId}/${clipId}`;
			const obj = await env.CLIPS_BUCKET.get(key);
			if (!obj) {
				return new Response('Not found', { status: 404, headers: corsHeaders(request) });
			}
			const rawType = obj.httpMetadata?.contentType || 'video/webm';
			const contentType = rawType.split(';')[0].trim();
			const headers = new Headers(corsHeaders(request));
			headers.set('Content-Type', contentType);
			headers.set('Cache-Control', 'public, max-age=86400');
			return new Response(obj.body, { headers });
		}

		return new Response('Not found', { status: 404, headers: corsHeaders(request) });
	}
} satisfies ExportedHandler<Env>;
