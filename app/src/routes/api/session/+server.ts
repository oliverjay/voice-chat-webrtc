import { json } from '@sveltejs/kit';
import { cfCallsApi } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	const data = await cfCallsApi('/sessions/new', 'POST');
	return json({ sessionId: data.sessionId });
};
