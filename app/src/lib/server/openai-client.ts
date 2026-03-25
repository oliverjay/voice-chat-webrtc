import OpenAI from 'openai';
import { getOpenAIKey } from '$lib/server/env';

/** Single client per process — reuses HTTP keep-alive to OpenAI. */
let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
	if (!client) {
		client = new OpenAI({ apiKey: getOpenAIKey() });
	}
	return client;
}
