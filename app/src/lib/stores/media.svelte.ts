import {
	getMediaStream,
	getDisplayStream,
	enumerateDevices,
	getCameras,
	getMics,
	getSpeakers,
	pickSmartDefault,
	onDeviceChange,
	type DeviceInfo
} from '$lib/utils/devices';
import {
	loadPreferences,
	saveCamera,
	saveMic,
	saveSpeaker,
	saveVideoEnabled,
	saveAudioEnabled
} from '$lib/utils/preferences';

class MediaStore {
	stream = $state<MediaStream | null>(null);
	screenStream = $state<MediaStream | null>(null);
	videoEnabled = $state(true);
	audioEnabled = $state(true);
	screenEnabled = $state(false);

	allDevices = $state<DeviceInfo[]>([]);
	selectedCamera = $state<string>('');
	selectedMic = $state<string>('');
	selectedSpeaker = $state<string>('');

	permissionGranted = $state(false);
	error = $state<string | null>(null);

	private deviceChangeCleanup: (() => void) | null = null;
	private _pc: RTCPeerConnection | null = null;

	get cameras() {
		return getCameras(this.allDevices);
	}
	get mics() {
		return getMics(this.allDevices);
	}
	get speakers() {
		return getSpeakers(this.allDevices);
	}

	setPeerConnection(pc: RTCPeerConnection | null) {
		this._pc = pc;
	}

	async init() {
		try {
			this.error = null;

			const prefs = loadPreferences();
			this.videoEnabled = prefs.videoEnabled;
			this.audioEnabled = prefs.audioEnabled;

			this.stream = await getMediaStream(true, true);
			this.permissionGranted = true;

			this.allDevices = await enumerateDevices();

			const bestCamera = pickSmartDefault(this.cameras, prefs.camera, 'videoinput');
			const bestMic = pickSmartDefault(this.mics, prefs.mic, 'audioinput');
			this.selectedSpeaker = pickSmartDefault(this.speakers, prefs.speaker, 'audiooutput');

			const currentCam = this.stream.getVideoTracks()[0]?.getSettings().deviceId;
			const currentMic = this.stream.getAudioTracks()[0]?.getSettings().deviceId;

			const needNewCam = bestCamera && currentCam !== bestCamera;
			const needNewMic = bestMic && currentMic !== bestMic;

			if (needNewCam || needNewMic) {
				try {
					this.stream.getTracks().forEach(t => t.stop());
					this.stream = await getMediaStream(
						needNewCam && bestCamera ? { deviceId: { exact: bestCamera } } : !needNewCam,
						needNewMic && bestMic ? { deviceId: { exact: bestMic } } : !needNewMic
					);
				} catch (e) {
					console.warn('[Media] Failed to switch to preferred devices, retrying with ideal:', e);
					try {
						this.stream = await getMediaStream(
							bestCamera ? { deviceId: { ideal: bestCamera } } : true,
							bestMic ? { deviceId: { ideal: bestMic } } : true
						);
					} catch (e2) {
						console.warn('[Media] Ideal also failed, using defaults:', e2);
						this.stream = await getMediaStream(true, true);
					}
				}
			}

			this.selectedCamera = this.stream.getVideoTracks()[0]?.getSettings().deviceId || bestCamera;
			this.selectedMic = this.stream.getAudioTracks()[0]?.getSettings().deviceId || bestMic;

			if (this.selectedCamera) saveCamera(this.selectedCamera);
			if (this.selectedMic) saveMic(this.selectedMic);
			if (this.selectedSpeaker) saveSpeaker(this.selectedSpeaker);

			console.log('[Media] Using camera:', this.cameras.find(c => c.deviceId === this.selectedCamera)?.label);
			console.log('[Media] Using mic:', this.mics.find(m => m.deviceId === this.selectedMic)?.label);

			for (const track of this.stream.getVideoTracks()) {
				track.enabled = this.videoEnabled;
			}
			for (const track of this.stream.getAudioTracks()) {
				track.enabled = this.audioEnabled;
			}

			this.deviceChangeCleanup?.();
			this.deviceChangeCleanup = onDeviceChange(async () => {
				console.log('[Media] Device change detected, re-enumerating');
				this.allDevices = await enumerateDevices();
			});
		} catch (e: any) {
			this.error =
				e.name === 'NotAllowedError'
					? 'Camera/microphone access denied. Please allow access in your browser settings.'
					: `Failed to access media devices: ${e.message}`;
			console.error('[Media]', e);
		}
	}

	toggleVideo() {
		if (!this.stream) return;
		this.videoEnabled = !this.videoEnabled;
		for (const track of this.stream.getVideoTracks()) {
			track.enabled = this.videoEnabled;
		}
		saveVideoEnabled(this.videoEnabled);
	}

	toggleAudio() {
		if (!this.stream) return;
		this.audioEnabled = !this.audioEnabled;
		for (const track of this.stream.getAudioTracks()) {
			track.enabled = this.audioEnabled;
		}
		saveAudioEnabled(this.audioEnabled);
	}

	async toggleScreen() {
		if (this.screenEnabled && this.screenStream) {
			this.screenStream.getTracks().forEach((t) => t.stop());
			this.screenStream = null;
			this.screenEnabled = false;
			return;
		}
		try {
			this.screenStream = await getDisplayStream();
			this.screenEnabled = true;
			this.screenStream.getVideoTracks()[0].addEventListener('ended', () => {
				this.screenStream = null;
				this.screenEnabled = false;
			});
		} catch (e: any) {
			console.log('[Media] Screen share cancelled or failed:', e.message);
		}
	}

	async switchCamera(deviceId: string) {
		if (!this.stream) return;
		this.selectedCamera = deviceId;
		saveCamera(deviceId);
		const newStream = await getMediaStream({ deviceId: { exact: deviceId } }, false);
		const newTrack = newStream.getVideoTracks()[0];
		const oldTrack = this.stream.getVideoTracks()[0];

		if (this._pc && oldTrack && newTrack) {
			const sender = this._pc.getSenders().find(s => s.track === oldTrack);
			if (sender) {
				await sender.replaceTrack(newTrack);
				console.log('[Media] replaceTrack (camera) — no renegotiation needed');
			}
		}

		if (oldTrack) {
			this.stream.removeTrack(oldTrack);
			oldTrack.stop();
		}
		if (newTrack) {
			newTrack.enabled = this.videoEnabled;
			this.stream.addTrack(newTrack);
		}
	}

	async switchMic(deviceId: string) {
		if (!this.stream) return;
		this.selectedMic = deviceId;
		saveMic(deviceId);
		const newStream = await getMediaStream(false, { deviceId: { exact: deviceId } });
		const newTrack = newStream.getAudioTracks()[0];
		const oldTrack = this.stream.getAudioTracks()[0];

		if (this._pc && oldTrack && newTrack) {
			const sender = this._pc.getSenders().find(s => s.track === oldTrack);
			if (sender) {
				await sender.replaceTrack(newTrack);
				console.log('[Media] replaceTrack (mic) — no renegotiation needed');
			}
		}

		if (oldTrack) {
			this.stream.removeTrack(oldTrack);
			oldTrack.stop();
		}
		if (newTrack) {
			newTrack.enabled = this.audioEnabled;
			this.stream.addTrack(newTrack);
		}
	}

	switchSpeaker(deviceId: string) {
		this.selectedSpeaker = deviceId;
		saveSpeaker(deviceId);
	}

	cleanup() {
		this.deviceChangeCleanup?.();
		this.deviceChangeCleanup = null;
		this._pc = null;
		this.stream?.getTracks().forEach((t) => t.stop());
		this.screenStream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
		this.screenStream = null;
	}
}

export const media = new MediaStore();
