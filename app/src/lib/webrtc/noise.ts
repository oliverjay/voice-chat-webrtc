export function supportsNoiseSuppression(): boolean {
	if (typeof window === 'undefined') return false;
	return (
		typeof AudioWorkletNode !== 'undefined' &&
		'createMediaStreamSource' in AudioContext.prototype &&
		typeof MediaStreamTrackProcessor !== 'undefined'
	);
}

let noiseEnabled = false;
let cleanupFn: (() => void) | null = null;

export function isNoiseSuppressionEnabled() {
	return noiseEnabled;
}

export async function enableNoiseSuppression(stream: MediaStream): Promise<MediaStream | null> {
	if (!supportsNoiseSuppression()) {
		console.log('[Noise] Not supported in this browser');
		return null;
	}

	try {
		const audioTrack = stream.getAudioTracks()[0];
		if (!audioTrack) return null;

		const ctx = new AudioContext({ sampleRate: 48000 });
		const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
		const destination = ctx.createMediaStreamDestination();

		source.connect(destination);

		const cleanStream = new MediaStream([
			...stream.getVideoTracks(),
			...destination.stream.getAudioTracks()
		]);

		noiseEnabled = true;

		cleanupFn = () => {
			ctx.close();
			noiseEnabled = false;
		};

		return cleanStream;
	} catch (e) {
		console.error('[Noise] Failed to enable:', e);
		return null;
	}
}

export function disableNoiseSuppression() {
	cleanupFn?.();
	cleanupFn = null;
	noiseEnabled = false;
}
