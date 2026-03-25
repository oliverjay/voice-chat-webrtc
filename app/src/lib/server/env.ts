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

export function getOpenAIKey() {
	const key = env.OPENAI_API_KEY;
	if (!key) {
		throw new Error('OPENAI_API_KEY must be set');
	}
	return key;
}

/** Chat model for agent replies. `gpt-4o-mini` is faster/cheaper; use `gpt-4o` for higher quality. */
export function getAgentChatModel() {
	return env.AGENT_CHAT_MODEL?.trim() || 'gpt-4o-mini';
}

export function getAgentMaxTokens() {
	const n = Number(env.AGENT_MAX_TOKENS);
	return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 500) : 200;
}

/** OpenAI TTS `speed` (0.25–4). Faster speech without chipmunk pitch (avoid client playbackRate). Default ~1.25. */
export function getAgentTtsSpeed(): number {
	const n = Number(env.AGENT_TTS_SPEED);
	if (!Number.isFinite(n)) return 1.25;
	return Math.min(4, Math.max(0.25, n));
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
