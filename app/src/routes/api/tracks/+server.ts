import { json } from '@sveltejs/kit';
import { cfCallsApi } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { sessionId, action, ...rest } = body;

	if (!sessionId) {
		return json({ error: 'sessionId required' }, { status: 400 });
	}

	const payload: any = { tracks: rest.tracks };

	if (action === 'push' && rest.sessionDescription) {
		payload.sessionDescription = rest.sessionDescription;
	}

	const data = await cfCallsApi(`/sessions/${sessionId}/tracks/new`, 'POST', payload);
	return json(data);
};
