const adjectives = [
	'Swift', 'Bright', 'Calm', 'Bold', 'Keen',
	'Witty', 'Vivid', 'Warm', 'Cool', 'Lucky',
	'Nimble', 'Chill', 'Plucky', 'Snappy', 'Breezy',
	'Dapper', 'Jolly', 'Mellow', 'Perky', 'Zippy',
	'Cozy', 'Gentle', 'Savvy', 'Dandy', 'Nifty',
	'Sparky', 'Steady', 'Peppy', 'Lively', 'Fizzy',
	'Sunny', 'Chirpy', 'Crisp', 'Snug', 'Tidy',
	'Zesty', 'Bouncy', 'Gleaming', 'Radiant', 'Stellar'
];

const animals = [
	'Panda', 'Otter', 'Fox', 'Owl', 'Falcon',
	'Koala', 'Penguin', 'Dolphin', 'Heron', 'Lynx',
	'Finch', 'Lemur', 'Robin', 'Corgi', 'Quokka',
	'Puffin', 'Gecko', 'Badger', 'Wombat', 'Parrot',
	'Raven', 'Sloth', 'Crane', 'Shiba', 'Bunny',
	'Moose', 'Newt', 'Dingo', 'Ibis', 'Meerkat',
	'Toucan', 'Orca', 'Fawn', 'Mantis', 'Jackal',
	'Kiwi', 'Pika', 'Ferret', 'Osprey', 'Capybara'
];

function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

export function generateRandomName(): string {
	return `${pick(adjectives)} ${pick(animals)}`;
}
