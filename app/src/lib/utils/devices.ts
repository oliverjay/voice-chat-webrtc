export async function getMediaStream(
	video: boolean | MediaTrackConstraints = true,
	audio: boolean | MediaTrackConstraints = true
): Promise<MediaStream> {
	return navigator.mediaDevices.getUserMedia({
		video: video
			? typeof video === 'object'
				? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 }, ...video }
				: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }
			: false,
		audio: audio
			? typeof audio === 'object'
				? { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...audio }
				: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
			: false
	});
}

export async function getDisplayStream(): Promise<MediaStream> {
	return navigator.mediaDevices.getDisplayMedia({
		video: { frameRate: { ideal: 24, max: 30 } },
		audio: true,
		surfaceSwitching: 'include',
		systemAudio: 'include'
	} as any);
}

export function onDeviceChange(callback: () => void): () => void {
	navigator.mediaDevices.addEventListener('devicechange', callback);
	return () => navigator.mediaDevices.removeEventListener('devicechange', callback);
}

export interface DeviceInfo {
	deviceId: string;
	label: string;
	kind: MediaDeviceKind;
}

export async function enumerateDevices(): Promise<DeviceInfo[]> {
	const devices = await navigator.mediaDevices.enumerateDevices();
	const counts: Record<string, number> = { audioinput: 0, videoinput: 0, audiooutput: 0 };

	return devices
		.filter((d) => d.kind === 'audioinput' || d.kind === 'videoinput' || d.kind === 'audiooutput')
		.map((d) => {
			counts[d.kind] = (counts[d.kind] || 0) + 1;
			const kindLabel =
				d.kind === 'audioinput' ? 'Microphone' : d.kind === 'videoinput' ? 'Camera' : 'Speaker';
			return {
				deviceId: d.deviceId,
				label: d.label || `${kindLabel} ${counts[d.kind]}`,
				kind: d.kind
			};
		});
}

export function getCameras(devices: DeviceInfo[]): DeviceInfo[] {
	return devices.filter((d) => d.kind === 'videoinput');
}

export function getMics(devices: DeviceInfo[]): DeviceInfo[] {
	return devices.filter((d) => d.kind === 'audioinput');
}

export function getSpeakers(devices: DeviceInfo[]): DeviceInfo[] {
	return devices.filter((d) => d.kind === 'audiooutput');
}

const VIRTUAL_BLACKLIST = ['background music', 'soundflower', 'blackhole', 'loopback', 'virtual', 'obs'];
const BUILTIN_KEYWORDS = ['built-in', 'internal', 'macbook', 'integrated', 'facetime', 'isight'];

export function pickSmartDefault(devices: DeviceInfo[], savedId?: string, kind?: MediaDeviceKind): string {
	if (!devices.length) return '';

	const isVirtual = (label: string) =>
		VIRTUAL_BLACKLIST.some((kw) => label.toLowerCase().includes(kw));

	if (savedId) {
		const saved = devices.find((d) => d.deviceId === savedId);
		if (saved && !isVirtual(saved.label)) return saved.deviceId;
	}

	const real = devices.filter((d) => d.deviceId !== 'default' && !isVirtual(d.label));

	const builtin = real.find((d) => {
		const label = d.label.toLowerCase();
		return BUILTIN_KEYWORDS.some((kw) => label.includes(kw));
	});
	if (builtin) return builtin.deviceId;

	if (real.length > 0) return real[0].deviceId;

	const defaultDevice = devices.find((d) => d.deviceId === 'default');
	if (defaultDevice) return defaultDevice.deviceId;

	return devices[0].deviceId;
}

export function getAudioLevel(stream: MediaStream): () => number {
	const ctx = new AudioContext();
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 256;
	const source = ctx.createMediaStreamSource(stream);
	source.connect(analyser);
	const data = new Uint8Array(analyser.frequencyBinCount);

	return () => {
		analyser.getByteFrequencyData(data);
		let sum = 0;
		for (let i = 0; i < data.length; i++) sum += data[i];
		return sum / data.length / 255;
	};
}

export async function setSinkId(element: HTMLMediaElement, deviceId: string) {
	if ('setSinkId' in element && typeof (element as any).setSinkId === 'function') {
		try {
			await (element as any).setSinkId(deviceId);
		} catch (e) {
			console.warn('[Devices] setSinkId failed:', e);
		}
	}
}

let testToneCtx: AudioContext | null = null;

export async function playTestTone(deviceId?: string) {
	try {
		if (testToneCtx) testToneCtx.close();

		const options: AudioContextOptions = {};
		if (deviceId && 'setSinkId' in AudioContext.prototype) {
			(options as any).sinkId = deviceId;
		}
		testToneCtx = new AudioContext(options);

		const osc = testToneCtx.createOscillator();
		const gain = testToneCtx.createGain();
		osc.type = 'sine';
		osc.frequency.value = 440;
		gain.gain.value = 0.15;
		osc.connect(gain);
		gain.connect(testToneCtx.destination);

		gain.gain.setValueAtTime(0.15, testToneCtx.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, testToneCtx.currentTime + 0.5);

		osc.start();
		osc.stop(testToneCtx.currentTime + 0.5);

		setTimeout(() => {
			testToneCtx?.close();
			testToneCtx = null;
		}, 600);
	} catch (e) {
		console.warn('[Devices] Test tone failed:', e);
	}
}
