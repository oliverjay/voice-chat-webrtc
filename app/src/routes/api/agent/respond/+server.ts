import { json } from '@sveltejs/kit';
import { getAgentChatModel, getAgentMaxTokens, getAgentTtsSpeed } from '$lib/server/env';
import { getOpenAIClient } from '$lib/server/openai-client';
import { getPersona } from '$lib/agents/personas';
import type { RequestHandler } from './$types';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/** In-memory TTS cache: greeting line + voice are fixed per persona — avoids repeated TTS on every agent join. */
const greetingTtsBase64 = new Map<string, string>();

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { slug, messages } = body;
	/** Only literal `true` — avoids accidental string/body truthy bugs. */
	const greeting = body?.greeting === true;

	const persona = getPersona(slug);
	if (!persona) {
		return json({ error: 'Unknown agent' }, { status: 400 });
	}

	const openai = getOpenAIClient();

	let responseText: string;

	if (greeting) {
		responseText = persona.greeting;
	} else {
		// Long static systemPrompt is eligible for OpenAI prompt caching (repeated prefix) on supported models.
		const chatMessages: ChatCompletionMessageParam[] = [
			{ role: 'system', content: persona.systemPrompt }
		];

		if (messages && Array.isArray(messages)) {
			for (const msg of messages.slice(-20)) {
				chatMessages.push({
					role: msg.isAgent ? 'assistant' : 'user',
					content: `${msg.name}: ${msg.text}`
				});
			}
		}

		const completion = await openai.chat.completions.create({
			model: getAgentChatModel(),
			messages: chatMessages,
			max_tokens: getAgentMaxTokens(),
			temperature: 0.8
		});

		responseText = completion.choices[0]?.message?.content || "Sorry, I didn't catch that.";
	}

	const ttsSpeed = getAgentTtsSpeed();
	const greetKey = greeting
		? `${persona.slug}:${persona.ttsVoice}:${fnv1a(persona.greeting)}:s${ttsSpeed}`
		: undefined;
	let audioBase64 = greetKey ? greetingTtsBase64.get(greetKey) : undefined;

	if (!audioBase64) {
		const ttsResponse = await openai.audio.speech.create({
			model: 'tts-1',
			voice: persona.ttsVoice,
			input: responseText,
			response_format: 'mp3',
			speed: ttsSpeed
		});

		const audioBuffer = await ttsResponse.arrayBuffer();
		audioBase64 = bufferToBase64(audioBuffer);
		if (greeting && greetKey) {
			greetingTtsBase64.set(greetKey, audioBase64);
		}
	}

	return json({ text: responseText, audio: audioBase64 });
};

function fnv1a(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16);
}

function bufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}
