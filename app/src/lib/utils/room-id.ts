const adjectives = [
	'calm', 'bold', 'bright', 'cool', 'swift', 'warm', 'deep', 'free',
	'kind', 'pure', 'vast', 'wild', 'keen', 'soft', 'fair', 'glad'
];

const nouns = [
	'ocean', 'river', 'cloud', 'stone', 'light', 'flame', 'frost', 'bloom',
	'storm', 'ridge', 'grove', 'shore', 'spark', 'drift', 'creek', 'dune'
];

function randomPick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

export function generateRoomId(): string {
	const adj = randomPick(adjectives);
	const noun = randomPick(nouns);
	const num = Math.floor(Math.random() * 90 + 10);
	return `${adj}-${noun}-${num}`;
}
