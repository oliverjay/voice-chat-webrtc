import type { AgentPersona } from './personas';

export const EMPTY_WAKE_PLACEHOLDER =
	'(They only used your name to get your attention — briefly acknowledge and ask what they need.)';

function escapeRe(s: string) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Longest-first for greedy matching of full name before short tokens. */
export function getWakePhrases(persona: AgentPersona): string[] {
	if (persona.wakePhrases?.length) {
		return [...persona.wakePhrases].sort((a, b) => b.length - a.length);
	}
	const full = persona.name.trim().toLowerCase();
	const parts = persona.name.split(/\s+/).filter((p) => p.length >= 2);
	const out = new Set<string>();
	if (full.length >= 2) out.add(full);
	for (const p of parts) out.add(p.toLowerCase());
	return [...out].sort((a, b) => b.length - a.length);
}

/**
 * Levenshtein distance — used to catch STT misspellings like
 * "hormozee", "her mosey", "mosey", "alexs", etc.
 */
function levenshtein(a: string, b: string): number {
	const m = a.length, n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
	for (let i = 1; i <= m; i++) {
		let prev = i - 1;
		dp[0] = i;
		for (let j = 1; j <= n; j++) {
			const tmp = dp[j];
			dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
			prev = tmp;
		}
	}
	return dp[n];
}

/**
 * Max edit distance allowed based on phrase length.
 * Short words (<=3 chars) must be exact. Longer words get more slack.
 */
function maxEditDistance(phrase: string): number {
	const len = phrase.length;
	if (len <= 3) return 0;
	if (len <= 5) return 1;
	return 2;
}

/**
 * Normalize text for matching: lowercase, collapse whitespace, strip common
 * STT artifacts (filler words, punctuation that STT inserts).
 */
function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/['']/g, "'")
		.replace(/[""]/g, '"')
		.replace(/[.,:;!?…—–\-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

interface WakeMatch {
	phrase: string;
	start: number;
	end: number;
	exact: boolean;
}

/**
 * Find the best wake match in normalized text, trying:
 * 1. Exact substring/word-boundary match (highest confidence)
 * 2. Fuzzy match via sliding window over words (catches STT errors)
 */
function findBestMatch(text: string, phrases: string[]): WakeMatch | null {
	const norm = normalize(text);
	let best: WakeMatch | null = null;

	for (const phrase of phrases) {
		const np = normalize(phrase);

		// 1. Exact match
		if (np.includes(' ')) {
			const idx = norm.indexOf(np);
			if (idx !== -1) {
				const m: WakeMatch = { phrase: np, start: idx, end: idx + np.length, exact: true };
				if (!best || np.length > best.phrase.length) best = m;
				continue;
			}
		} else {
			const re = new RegExp(`\\b${escapeRe(np)}\\b`);
			const match = norm.match(re);
			if (match && match.index !== undefined) {
				const m: WakeMatch = { phrase: np, start: match.index, end: match.index + match[0].length, exact: true };
				if (!best || np.length > best.phrase.length) best = m;
				continue;
			}
		}

		// 2. Fuzzy: slide a window of the same word count over the text words
		const phraseWords = np.split(' ');
		const phraseCollapsed = phraseWords.join('');
		const maxDist = maxEditDistance(phraseCollapsed);
		if (maxDist === 0) continue;

		const textWords = norm.split(' ');
		for (let i = 0; i <= textWords.length - phraseWords.length; i++) {
			const windowWords = textWords.slice(i, i + phraseWords.length);
			const window = windowWords.join(' ');
			const windowCollapsed = windowWords.join('');

			// For single-word phrases, require same first letter and same length to
			// avoid "alexa" → "alex" type false positives.
			if (phraseWords.length === 1) {
				const w = windowWords[0];
				if (w[0] !== np[0] || w.length !== np.length) continue;
			}

			const dist = Math.min(
				levenshtein(window, np),
				levenshtein(windowCollapsed, phraseCollapsed)
			);

			if (dist <= maxDist) {
				const startIdx = norm.indexOf(textWords[i], i > 0 ? norm.indexOf(textWords[i - 1]) + textWords[i - 1].length : 0);
				const endWord = textWords[i + phraseWords.length - 1];
				const endIdx = norm.indexOf(endWord, startIdx) + endWord.length;
				const m: WakeMatch = { phrase: np, start: startIdx, end: endIdx, exact: false };
				if (!best || np.length > best.phrase.length || (np.length === best.phrase.length && !best.exact)) {
					best = m;
				}
				break;
			}
		}

		// Also try single-word fuzzy for single-word phrases against each text word.
		// Guards: same first letter, same length (substitutions only, no insertions/deletions)
		// to avoid false positives like "alexa" → "alex" or "bobby" → "bob".
		if (phraseWords.length === 1) {
			for (let i = 0; i < textWords.length; i++) {
				const w = textWords[i];
				if (w[0] !== np[0]) continue;
				if (w.length !== np.length) continue;
				const dist = levenshtein(w, np);
				if (dist > 0 && dist <= maxDist) {
					const startIdx = norm.indexOf(w, i > 0 ? norm.indexOf(textWords[i - 1]) + textWords[i - 1].length : 0);
					const m: WakeMatch = { phrase: np, start: startIdx, end: startIdx + w.length, exact: false };
					if (!best || np.length > best.phrase.length) best = m;
					break;
				}
			}
		}
	}

	return best;
}

/** True if text contains a wake phrase (exact or fuzzy). */
export function wakeMatchesText(text: string, persona: AgentPersona): boolean {
	return findBestMatch(text, getWakePhrases(persona)) !== null;
}

/**
 * Text after the earliest-in-string wake match (reading order).
 * Single-word phrases use word boundaries so "alex" does not match inside "alexander".
 */
export function extractAfterWake(text: string, persona: AgentPersona): string | null {
	const match = findBestMatch(text, getWakePhrases(persona));
	if (!match) return null;
	const norm = normalize(text);
	return norm.slice(match.end).trim().replace(/^[.,:;\-–—]\s*/, '').trim();
}

/**
 * Prompt to send to the model for the user's line.
 * Strips the wake phrase and returns the remaining text (before + after).
 * Returns null if this message should not wake the agent.
 */
export function wakeDirectPrompt(text: string, persona: AgentPersona): string | null {
	const match = findBestMatch(text, getWakePhrases(persona));
	if (!match) return null;

	const norm = normalize(text);
	const before = norm.slice(0, match.start).trim();
	const after = norm.slice(match.end).trim();
	const combined = [before, after].filter(Boolean).join(' ').trim();

	return combined || EMPTY_WAKE_PLACEHOLDER;
}
