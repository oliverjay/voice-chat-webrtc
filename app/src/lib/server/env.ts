import { env } from '$env/dynamic/private';

export function getCfCallsConfig() {
	const appId = env.CF_CALLS_APP_ID;
	const appSecret = env.CF_CALLS_APP_SECRET;
	if (!appId || !appSecret) {
		throw new Error('CF_CALLS_APP_ID and CF_CALLS_APP_SECRET must be set');
	}
	return { appId, appSecret };
}

export function getRoomServerUrl() {
	return env.ROOM_SERVER_URL || 'http://localhost:8787';
}

const CF_BASE = 'https://rtc.live.cloudflare.com/v1';

export async function cfCallsApi(path: string, method: string, body?: any) {
	const { appId, appSecret } = getCfCallsConfig();
	const url = `${CF_BASE}/apps/${appId}${path}`;

	console.log(`[CF Calls] ${method} ${url}`);

	const res = await fetch(url, {
		method,
		headers: {
			Authorization: `Bearer ${appSecret}`,
			'Content-Type': 'application/json'
		},
		body: body ? JSON.stringify(body) : undefined
	});

	if (!res.ok) {
		const text = await res.text();
		console.error(`[CF Calls] Error ${res.status}: ${text}`);
		throw new Error(`CF Calls API error: ${res.status} ${text}`);
	}

	return res.json();
}
