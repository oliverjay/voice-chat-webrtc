import { json } from '@sveltejs/kit';
import { cfCallsApi } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { sessionId, sessionDescription } = body;

	if (!sessionId || !sessionDescription) {
		return json({ error: 'sessionId and sessionDescription required' }, { status: 400 });
	}

	const data = await cfCallsApi(`/sessions/${sessionId}/renegotiate`, 'PUT', {
		sessionDescription
	});
	return json(data);
};
