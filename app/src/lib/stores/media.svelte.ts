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
	saveAudioEnabled,
	saveSpeakerMuted
} from '$lib/utils/preferences';

class MediaStore {
	stream = $state<MediaStream | null>(null);
	screenStream = $state<MediaStream | null>(null);
	videoEnabled = $state(true);
	audioEnabled = $state(true);
	speakerMuted = $state(false);
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
			this.speakerMuted = prefs.speakerMuted;

			const wantVideo = this.videoEnabled;

			this.stream = await getMediaStream(wantVideo, true);
			this.permissionGranted = true;

			this.allDevices = await enumerateDevices();

			const bestCamera = pickSmartDefault(this.cameras, prefs.camera, 'videoinput');
			const bestMic = pickSmartDefault(this.mics, prefs.mic, 'audioinput');
			this.selectedSpeaker = pickSmartDefault(this.speakers, prefs.speaker, 'audiooutput');

			const currentCam = this.stream.getVideoTracks()[0]?.getSettings().deviceId;
			const currentMic = this.stream.getAudioTracks()[0]?.getSettings().deviceId;

			const needNewCam = wantVideo && bestCamera && currentCam !== bestCamera;
			const needNewMic = bestMic && currentMic !== bestMic;

			if (needNewCam || needNewMic) {
				try {
					this.stream.getTracks().forEach(t => t.stop());
					this.stream = await getMediaStream(
						needNewCam && bestCamera ? { deviceId: { exact: bestCamera } } : wantVideo && !needNewCam,
						needNewMic && bestMic ? { deviceId: { exact: bestMic } } : !needNewMic
					);
				} catch (e) {
					console.warn('[Media] Failed to switch to preferred devices, retrying with ideal:', e);
					try {
						this.stream = await getMediaStream(
							wantVideo ? (bestCamera ? { deviceId: { ideal: bestCamera } } : true) : false,
							bestMic ? { deviceId: { ideal: bestMic } } : true
						);
					} catch (e2) {
						console.warn('[Media] Ideal also failed, using defaults:', e2);
						this.stream = await getMediaStream(wantVideo, true);
					}
				}
			}

			this.selectedCamera = this.stream.getVideoTracks()[0]?.getSettings().deviceId || bestCamera;
			this.selectedMic = this.stream.getAudioTracks()[0]?.getSettings().deviceId || bestMic;

			if (this.selectedCamera) saveCamera(this.selectedCamera);
			if (this.selectedMic) saveMic(this.selectedMic);
			if (this.selectedSpeaker) saveSpeaker(this.selectedSpeaker);

			console.log('[Media] Using camera:', wantVideo
				? (this.cameras.find(c => c.deviceId === this.selectedCamera)?.label ?? 'none')
				: '(off)');
			console.log('[Media] Using mic:', this.mics.find(m => m.deviceId === this.selectedMic)?.label);

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

	async toggleVideo() {
		if (!this.stream) return;
		this.videoEnabled = !this.videoEnabled;
		saveVideoEnabled(this.videoEnabled);

		if (!this.videoEnabled) {
			const videoTrack = this.stream.getVideoTracks()[0];
			if (videoTrack) {
				if (this._pc) {
					const sender = this._pc.getSenders().find(s => s.track === videoTrack);
					if (sender) {
						await sender.replaceTrack(null);
						console.log('[Media] replaceTrack(null) — camera released');
					}
				}
				this.stream.removeTrack(videoTrack);
				videoTrack.stop();
				this.stream = new MediaStream(this.stream.getTracks());
			}
		} else {
			try {
				const constraints: MediaTrackConstraints = this.selectedCamera
					? { deviceId: { exact: this.selectedCamera } }
					: {};
				const newStream = await getMediaStream(constraints, false);
				const newTrack = newStream.getVideoTracks()[0];
				if (newTrack) {
					if (this._pc) {
						const transceiver = this._pc.getTransceivers().find(
							t => t.sender.track === null && t.receiver.track?.kind === 'video'
						);
						if (transceiver) {
							await transceiver.sender.replaceTrack(newTrack);
							console.log('[Media] replaceTrack(new) — camera restored');
						}
					}
					this.stream.addTrack(newTrack);
					this.stream = new MediaStream(this.stream.getTracks());
				}
			} catch (e) {
				console.error('[Media] toggleVideo re-acquire failed:', e);
				this.videoEnabled = false;
				saveVideoEnabled(false);
			}
		}
	}

	toggleAudio() {
		if (!this.stream) return;
		this.audioEnabled = !this.audioEnabled;
		for (const track of this.stream.getAudioTracks()) {
			track.enabled = this.audioEnabled;
		}
		saveAudioEnabled(this.audioEnabled);
	}

	toggleSpeaker() {
		this.speakerMuted = !this.speakerMuted;
		saveSpeakerMuted(this.speakerMuted);
		this.applySpeakerMuteToElements();
	}

	applySpeakerMuteToElements() {
		document.querySelectorAll<HTMLVideoElement | HTMLAudioElement>('video:not([data-local]), audio:not([data-local])').forEach(el => {
			el.muted = this.speakerMuted;
		});
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
		try {
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

			this.stream = new MediaStream(this.stream.getTracks());
		} catch (e) {
			console.error('[Media] switchCamera failed:', e);
		}
	}

	async switchMic(deviceId: string) {
		if (!this.stream) return;
		this.selectedMic = deviceId;
		saveMic(deviceId);
		try {
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

			this.stream = new MediaStream(this.stream.getTracks());
		} catch (e) {
			console.error('[Media] switchMic failed:', e);
		}
	}

	switchSpeaker(deviceId: string) {
		this.selectedSpeaker = deviceId;
		saveSpeaker(deviceId);
		this.applySpeakerToElements();
	}

	applySpeakerToElements() {
		document.querySelectorAll<HTMLVideoElement | HTMLAudioElement>('video, audio').forEach(el => {
			if (this.selectedSpeaker && 'setSinkId' in el && typeof (el as any).setSinkId === 'function') {
				(el as any).setSinkId(this.selectedSpeaker).catch((e: any) => {
					console.warn('[Media] setSinkId failed:', e);
				});
			}
			if (!el.hasAttribute('data-local')) {
				el.muted = this.speakerMuted;
			}
		});
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
