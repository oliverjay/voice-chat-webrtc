import { json } from '@sveltejs/kit';
import { cfCallsApi } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { sessionId, tracks } = body;

	if (!sessionId) {
		return json({ error: 'sessionId required' }, { status: 400 });
	}

	const data = await cfCallsApi(`/sessions/${sessionId}/tracks/update`, 'PUT', { tracks });
	return json(data);
};
