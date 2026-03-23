import { json } from '@sveltejs/kit';
import { cfCallsApi } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { sessionId, tracks, force } = body;

	if (!sessionId || !tracks) {
		return json({ error: 'sessionId and tracks required' }, { status: 400 });
	}

	const data = await cfCallsApi(`/sessions/${sessionId}/tracks/close`, 'PUT', {
		tracks,
		force: force ?? false
	});
	return json(data);
};
