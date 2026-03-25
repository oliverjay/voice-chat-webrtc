import { describe, it, expect } from 'vitest';
import { wakeMatchesText, wakeDirectPrompt, getWakePhrases } from './wake';
import type { AgentPersona } from './personas';

const hormozi: AgentPersona = {
	slug: 'hormozi',
	name: 'Alex Hormozi',
	tagline: 'Growth & Revenue',
	avatarUrl: '/agents/hormozi.jpg',
	greeting: '',
	ttsVoice: 'onyx',
	systemPrompt: '',
	wakePhrases: ['alex hormozi', 'hormozi', 'alex', 'hormozee', 'hormozy', 'hermozi', 'mosey', 'mozi', 'mozy']
};

const bob: AgentPersona = {
	slug: 'bob',
	name: 'Bob Smith',
	tagline: 'Advisor',
	avatarUrl: '',
	greeting: '',
	ttsVoice: 'alloy',
	systemPrompt: ''
};

describe('getWakePhrases', () => {
	it('returns custom wake phrases sorted by length', () => {
		const p = getWakePhrases(hormozi);
		expect(p[0]).toBe('alex hormozi');
		expect(p.length).toBe(9);
	});

	it('auto-generates from name when no wakePhrases', () => {
		const p = getWakePhrases(bob);
		expect(p).toContain('bob smith');
		expect(p).toContain('bob');
		expect(p).toContain('smith');
	});
});

describe('wakeMatchesText — exact matches', () => {
	it.each([
		'Alex help me',
		'hey Alex',
		'ALEX HORMOZI what do you think',
		'hormozi, give me advice',
		'tell me Alex what should I do',
		'does for you Alex',
		'Alex, help',
		'ask alex hormozi about pricing',
	])('matches: "%s"', (text) => {
		expect(wakeMatchesText(text, hormozi)).toBe(true);
	});

	it.each([
		'I was talking to Alexander about this',
		'the alexis thing is broken',
		'alexa play music',
	])('does NOT match: "%s"', (text) => {
		expect(wakeMatchesText(text, hormozi)).toBe(false);
	});
});

describe('wakeMatchesText — fuzzy STT errors', () => {
	it.each([
		'hormozee help me',
		'hormozy what do you think',
		'hey hermozi',
		'call mosey give me advice',
		'her mosey give me business advice',
	])('fuzzy matches: "%s"', (text) => {
		expect(wakeMatchesText(text, hormozi)).toBe(true);
	});
});

describe('wakeDirectPrompt — extracts correct text', () => {
	it('name at end: "does for you Alex"', () => {
		const result = wakeDirectPrompt('does for you Alex', hormozi);
		expect(result).toBe('does for you');
	});

	it('name at start: "Alex help me with pricing"', () => {
		const result = wakeDirectPrompt('Alex help me with pricing', hormozi);
		expect(result).toBe('help me with pricing');
	});

	it('name in middle: "hey Alex what should I charge"', () => {
		const result = wakeDirectPrompt('hey Alex what should I charge', hormozi);
		expect(result).toBe('hey what should i charge');
	});

	it('full name: "Alex Hormozi, what is a good offer?"', () => {
		const result = wakeDirectPrompt('Alex Hormozi, what is a good offer?', hormozi);
		expect(result).toBe('what is a good offer');
	});

	it('name only: "Alex"', () => {
		const result = wakeDirectPrompt('Alex', hormozi);
		expect(result).not.toBeNull();
		expect(result).toContain('attention');
	});

	it('name only with punctuation: "Alex!"', () => {
		const result = wakeDirectPrompt('Alex!', hormozi);
		expect(result).not.toBeNull();
		expect(result).toContain('attention');
	});

	it('no match returns null', () => {
		expect(wakeDirectPrompt('hello everyone', hormozi)).toBeNull();
	});

	it('multi-line burst with name in first line', () => {
		const text = 'Alex help me\nwith my pricing strategy';
		const result = wakeDirectPrompt(text, hormozi);
		expect(result).toContain('help me');
		expect(result).toContain('pricing strategy');
	});

	it('multi-line burst with name in last line', () => {
		const text = "let's get to it\nwhat do you think Alex";
		const result = wakeDirectPrompt(text, hormozi);
		expect(result).toContain("let's get to it");
		expect(result).toContain('what do you think');
	});

	it('messy STT with commas and filler: "um, Alex, like, help me with leads"', () => {
		const result = wakeDirectPrompt('um, Alex, like, help me with leads', hormozi);
		expect(result).not.toBeNull();
		expect(result).toContain('help me with leads');
	});
});

describe('wakeDirectPrompt — multi-person scenarios', () => {
	it('burst from multiple people with name mentioned once', () => {
		const burst = "I think we should focus on the offer\nAlex what do you think about our pricing\nyeah I agree with that";
		const result = wakeDirectPrompt(burst, hormozi);
		expect(result).not.toBeNull();
		expect(result).toContain('pricing');
	});
});

describe('wakeDirectPrompt — STT garbage and edge cases', () => {
	it('repeated words from STT stutter: "Alex Alex help me"', () => {
		const result = wakeDirectPrompt('Alex Alex help me', hormozi);
		expect(result).not.toBeNull();
		expect(result).toContain('help me');
	});

	it('punctuation-heavy STT: "alex... um, like... help with... pricing?"', () => {
		const result = wakeDirectPrompt('alex... um, like... help with... pricing?', hormozi);
		expect(result).not.toBeNull();
		expect(result).toContain('help with');
		expect(result).toContain('pricing');
	});

	it('all-caps yelling: "ALEX WHAT DO I DO"', () => {
		const result = wakeDirectPrompt('ALEX WHAT DO I DO', hormozi);
		expect(result).toBe('what do i do');
	});

	it('empty string returns null', () => {
		expect(wakeDirectPrompt('', hormozi)).toBeNull();
	});

	it('whitespace only returns null', () => {
		expect(wakeDirectPrompt('   ', hormozi)).toBeNull();
	});

	it('very long message with name buried in middle', () => {
		const text = 'so I was thinking about this the other day and I wanted to ask Alex about what he thinks about subscription pricing for a SaaS product that targets SMBs in the dental space';
		const result = wakeDirectPrompt(text, hormozi);
		expect(result).not.toBeNull();
		expect(result).toContain('subscription pricing');
	});

	it('name with apostrophe: "Alex\'s advice on this"', () => {
		const result = wakeDirectPrompt("what's Alex's take on this", hormozi);
		expect(result).not.toBeNull();
	});
});

describe('wakeMatchesText — false positive resistance', () => {
	it.each([
		'the algorithm is working',
		'I need to fix this bug',
		'let me share my screen',
		'can everyone hear me',
		'that sounds good to me',
		'what do you think about this approach',
	])('does NOT false-trigger on general chat: "%s"', (text) => {
		expect(wakeMatchesText(text, hormozi)).toBe(false);
	});
});

describe('wakeMatchesText — Bob (no custom wake phrases)', () => {
	it('matches first name', () => {
		expect(wakeMatchesText('hey Bob what do you think', bob)).toBe(true);
	});

	it('matches last name', () => {
		expect(wakeMatchesText('Smith, give me advice', bob)).toBe(true);
	});

	it('matches full name', () => {
		expect(wakeMatchesText('Bob Smith help me', bob)).toBe(true);
	});

	it('does not false-positive on bobby', () => {
		expect(wakeMatchesText('bobby help me', bob)).toBe(false);
	});
});
