const PREFIX = 'vc:';

const KEYS = {
	name: `${PREFIX}name`,
	camera: `${PREFIX}camera`,
	mic: `${PREFIX}mic`,
	speaker: `${PREFIX}speaker`,
	videoEnabled: `${PREFIX}videoEnabled`,
	audioEnabled: `${PREFIX}audioEnabled`,
	speakerMuted: `${PREFIX}speakerMuted`
} as const;

function get(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function set(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {}
}

export function loadPreferences() {
	return {
		name: get(KEYS.name) || '',
		camera: get(KEYS.camera) || '',
		mic: get(KEYS.mic) || '',
		speaker: get(KEYS.speaker) || '',
		videoEnabled: get(KEYS.videoEnabled) !== 'false',
		audioEnabled: get(KEYS.audioEnabled) !== 'false',
		speakerMuted: get(KEYS.speakerMuted) === 'true'
	};
}

export function saveName(value: string) {
	set(KEYS.name, value);
}

export function saveCamera(deviceId: string) {
	set(KEYS.camera, deviceId);
}

export function saveMic(deviceId: string) {
	set(KEYS.mic, deviceId);
}

export function saveSpeaker(deviceId: string) {
	set(KEYS.speaker, deviceId);
}

export function saveVideoEnabled(enabled: boolean) {
	set(KEYS.videoEnabled, String(enabled));
}

export function saveAudioEnabled(enabled: boolean) {
	set(KEYS.audioEnabled, String(enabled));
}

export function saveSpeakerMuted(muted: boolean) {
	set(KEYS.speakerMuted, String(muted));
}

export function getClientId(): string {
	const key = `${PREFIX}clientId`;
	try {
		let id = sessionStorage.getItem(key);
		if (!id) {
			id = crypto.randomUUID();
			sessionStorage.setItem(key, id);
		}
		return id;
	} catch {
		return crypto.randomUUID();
	}
}
