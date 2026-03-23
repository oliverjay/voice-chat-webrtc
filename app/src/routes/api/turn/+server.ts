import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	const keyId = env.CF_TURN_KEY_ID;
	const keySecret = env.CF_TURN_KEY_SECRET;

	if (!keyId || !keySecret) {
		return json({
			iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }]
		});
	}

	try {
		const res = await fetch(
			`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${keySecret}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ ttl: 86400 })
			}
		);

		if (!res.ok) {
			console.error('[TURN] Credential generation failed:', res.status, await res.text());
			return json({
				iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }]
			});
		}

		const data = await res.json();
		return json(data);
	} catch (e) {
		console.error('[TURN] Failed to generate credentials:', e);
		return json({
			iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }]
		});
	}
};
