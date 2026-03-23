<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { media } from '$lib/stores/media.svelte';
	import { room } from '$lib/stores/room.svelte';
	import { loadPreferences, getClientId } from '$lib/utils/preferences';
	import VideoTile from '$lib/components/VideoTile.svelte';
	import ControlBar from '$lib/components/ControlBar.svelte';
	import ChatPanel from '$lib/components/ChatPanel.svelte';
	import {
		createSession,
		pushLocalTracks,
		pullRemoteTracks,
		renegotiate,
		closeTracks,
		createPeerConnection,
		getConnectionQuality,
		enableOpusDtxInSdp
	} from '$lib/webrtc/session';
	import type { Participant, ServerMessage } from '$lib/room/protocol';

	function getRoomServerUrl() {
		if (!browser) return 'ws://localhost:8787';
		const env = import.meta.env.VITE_ROOM_SERVER_URL;
		if (env) return env;
		const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
		return `${proto}://${window.location.host}/ws-room`;
	}
	const ROOM_SERVER_URL = getRoomServerUrl();

	const roomId = $derived($page.params.room ?? '');
	let userName = $state('Anonymous');
	const clientId = browser ? getClientId() : '';

	if (browser) {
		userName = loadPreferences().name || 'Anonymous';
	}

	let chatOpen = $state(false);
	let unreadChat = $state(false);
	let lastSeenChatCount = -1;

	$effect(() => {
		const count = room.chatMessages.length;
		if (lastSeenChatCount < 0) {
			lastSeenChatCount = count;
			return;
		}
		if (count > lastSeenChatCount && !chatOpen) {
			unreadChat = true;
		}
		if (chatOpen) {
			unreadChat = false;
			lastSeenChatCount = count;
		}
	});

	let pc: RTCPeerConnection | null = null;
	let sessionId = $state('');
	let localAudioTrackName = $state('');
	let localVideoTrackName = $state('');
	let localScreenTrackName = $state('');
	let localScreenMid = $state('');
	let pulledTracks = $state<Map<string, string>>(new Map());
	let participantStreams = $state<Map<string, MediaStream>>(new Map());
	let screenStreams = $state<Map<string, MediaStream>>(new Map());
	let cleanup: (() => void) | null = null;
	let callError = $state<string | null>(null);
	let cfCallsAvailable = $state(false);
	let negotiationQueue: Array<() => Promise<void>> = [];
	let negotiating = false;

	let activeSpeakerId = $state<string>('');
	let pinnedId = $state<string>('');
	let speakerLevels = new Map<string, number>();
	let speakerCandidate = '';
	let speakerCandidateStart = 0;
	let speakerAnalysers = new Map<string, { ctx: AudioContext; analyser: AnalyserNode; data: Float32Array<ArrayBuffer> }>();
	let speakerRafId: number | null = null;

	let connectionQuality = $state<'good' | 'fair' | 'poor' | 'unknown'>('unknown');
	let qualityInterval: ReturnType<typeof setInterval> | null = null;
	let reconnecting = $state(false);
	let reconnectAttempt = 0;
	const MAX_ICE_RECONNECTS = 5;
	let iceRestartTimeout: ReturnType<typeof setTimeout> | null = null;
	let lastQuality: 'good' | 'fair' | 'poor' | 'unknown' = 'unknown';

	function startQualityMonitor() {
		if (qualityInterval) return;
		qualityInterval = setInterval(async () => {
			if (!pc) return;
			connectionQuality = await getConnectionQuality(pc);

			if (connectionQuality !== lastQuality) {
				if (connectionQuality === 'poor' && lastQuality !== 'poor') {
					applyAdaptiveBitrate('poor');
				} else if (connectionQuality === 'fair' && lastQuality === 'good') {
					applyAdaptiveBitrate('fair');
				} else if (connectionQuality === 'good') {
					applyAdaptiveBitrate('good');
				}
				lastQuality = connectionQuality;
			}
		}, 3000);
	}

	function stopQualityMonitor() {
		if (qualityInterval) {
			clearInterval(qualityInterval);
			qualityInterval = null;
		}
	}

	async function applyAdaptiveBitrate(quality: 'good' | 'fair' | 'poor') {
		if (!pc) return;
		for (const sender of pc.getSenders()) {
			if (sender.track?.kind !== 'video') continue;
			const params = sender.getParameters();
			if (!params.encodings?.length) continue;

			for (const enc of params.encodings) {
				if (quality === 'good') {
					if (enc.rid === 'h') enc.maxBitrate = 1_200_000;
					else if (enc.rid === 'm') enc.maxBitrate = 500_000;
					else if (enc.rid === 'l') enc.maxBitrate = 150_000;
					else enc.maxBitrate = 1_200_000;
					enc.active = true;
				} else if (quality === 'fair') {
					if (enc.rid === 'h') { enc.maxBitrate = 600_000; }
					else if (enc.rid === 'm') { enc.maxBitrate = 300_000; }
					else if (enc.rid === 'l') { enc.maxBitrate = 100_000; }
					else { enc.maxBitrate = 600_000; }
					enc.active = true;
				} else {
					if (enc.rid === 'h') { enc.active = false; }
					else if (enc.rid === 'm') { enc.maxBitrate = 200_000; }
					else if (enc.rid === 'l') { enc.maxBitrate = 80_000; }
					else { enc.maxBitrate = 200_000; }
				}
			}

			try {
				await sender.setParameters(params);
				console.log('[Call] Adaptive bitrate applied:', quality);
			} catch (e) {
				console.warn('[Call] Failed to set send parameters:', e);
			}
		}
	}

	function handleIceStateChange() {
		if (!pc) return;
		const state = pc.iceConnectionState;
		console.log('[Call] ICE state:', state);

		if (state === 'disconnected') {
			reconnecting = true;
			if (!iceRestartTimeout) {
				iceRestartTimeout = setTimeout(() => {
					iceRestartTimeout = null;
					if (pc?.iceConnectionState === 'disconnected' || pc?.iceConnectionState === 'failed') {
						attemptIceRestart();
					}
				}, 3000);
			}
		} else if (state === 'failed') {
			reconnecting = true;
			if (iceRestartTimeout) {
				clearTimeout(iceRestartTimeout);
				iceRestartTimeout = null;
			}
			attemptIceRestart();
		} else if (state === 'connected' || state === 'completed') {
			reconnecting = false;
			reconnectAttempt = 0;
			if (iceRestartTimeout) {
				clearTimeout(iceRestartTimeout);
				iceRestartTimeout = null;
			}
		}
	}

	async function attemptIceRestart() {
		if (!pc || !sessionId || !cfCallsAvailable) return;
		if (reconnectAttempt >= MAX_ICE_RECONNECTS) {
			console.error('[Call] Max ICE restart attempts reached, rebuilding session');
			await rebuildSession();
			return;
		}

		reconnectAttempt++;
		console.log(`[Call] ICE restart attempt ${reconnectAttempt}/${MAX_ICE_RECONNECTS}`);

		try {
			const offer = await pc.createOffer({ iceRestart: true });
			await pc.setLocalDescription(offer);

			const transceivers = pc.getTransceivers();
			const trackMappings: Array<{ trackName: string; mid: string }> = [];
			for (const t of transceivers) {
				if (t.sender.track && t.mid) {
					const existingName = t.sender.track.kind === 'audio' ? localAudioTrackName
						: t.sender.track.kind === 'video' && t.sender.track !== media.screenStream?.getVideoTracks()[0] ? localVideoTrackName
						: localScreenTrackName;
					if (existingName) {
						trackMappings.push({ trackName: existingName, mid: t.mid });
					}
				}
			}

			if (trackMappings.length > 0) {
				const pushResult = await pushLocalTracks(sessionId, offer.sdp!, trackMappings);
				if (pushResult.sessionDescription) {
					await pc.setRemoteDescription(new RTCSessionDescription({
						type: pushResult.sessionDescription.type,
						sdp: pushResult.sessionDescription.sdp
					}));
				}
			}
		} catch (e) {
			console.error('[Call] ICE restart failed:', e);
			const delay = Math.min(2000 * 2 ** (reconnectAttempt - 1), 15000);
			setTimeout(() => attemptIceRestart(), delay);
		}
	}

	async function rebuildSession() {
		console.log('[Call] Rebuilding entire WebRTC session');
		reconnecting = true;

		try {
			stopQualityMonitor();
			media.setPeerConnection(null);
			if (pc) { pc.close(); pc = null; }

			pulledTracks = new Map();
			participantStreams = new Map();
			screenStreams = new Map();
			negotiationQueue = [];
			negotiating = false;
			reconnectAttempt = 0;

			sessionId = await createSession();
			console.log('[Call] New session created:', sessionId);

			pc = await createPeerConnection();
			media.setPeerConnection(pc);
			wireUpPeerConnection();

			if (media.stream) {
				for (const track of media.stream.getTracks()) {
					if (track.kind === 'video') {
						pc.addTransceiver(track, {
							direction: 'sendonly',
							streams: [media.stream],
							sendEncodings: [
								{ rid: 'h', maxBitrate: 1_200_000 },
								{ rid: 'm', maxBitrate: 500_000, scaleResolutionDownBy: 2 },
								{ rid: 'l', maxBitrate: 150_000, scaleResolutionDownBy: 4 }
							]
						});
					} else {
						pc.addTrack(track, media.stream);
					}
				}
			}

			const offer = await pc.createOffer();
			const dtxSdp = enableOpusDtxInSdp(offer.sdp!);
			await pc.setLocalDescription({ ...offer, sdp: dtxSdp });

			const transceivers = pc.getTransceivers();
			const trackMappings: Array<{ trackName: string; mid: string }> = [];
			for (const t of transceivers) {
				if (t.sender.track && t.mid) {
					const trackName = crypto.randomUUID();
					trackMappings.push({ trackName, mid: t.mid });
					if (t.sender.track.kind === 'audio') localAudioTrackName = trackName;
					if (t.sender.track.kind === 'video') localVideoTrackName = trackName;
				}
			}

			const pushResult = await pushLocalTracks(sessionId, dtxSdp, trackMappings);
			if (pushResult.sessionDescription) {
				await pc.setRemoteDescription(new RTCSessionDescription({
					type: pushResult.sessionDescription.type,
					sdp: pushResult.sessionDescription.sdp
				}));
			}

			startQualityMonitor();

			room.join(userName, sessionId, clientId, localAudioTrackName, localVideoTrackName);

			for (const p of room.otherParticipants) {
				await pullParticipantTracks(p);
			}

			reconnecting = false;
			console.log('[Call] Session rebuilt successfully');
		} catch (e) {
			console.error('[Call] Session rebuild failed:', e);
			setTimeout(() => rebuildSession(), 5000);
		}
	}

	const SPEAKER_SWITCH_MS = 800;

	function setupSpeakerDetection() {
		if (speakerRafId !== null) return;

		function pollSpeakers() {
			const now = Date.now();
			let loudestId = '';
			let loudestLevel = 0;

			for (const [pid, info] of speakerAnalysers) {
				info.analyser.getFloatTimeDomainData(info.data);
				let sum = 0;
				for (let i = 0; i < info.data.length; i++) sum += info.data[i] * info.data[i];
				const rms = Math.sqrt(sum / info.data.length);
				const level = Math.min(1, rms / 0.15);
				speakerLevels.set(pid, level);

				if (level > loudestLevel && level > 0.03) {
					loudestLevel = level;
					loudestId = pid;
				}
			}

			if (!pinnedId && loudestId && loudestId !== activeSpeakerId) {
				if (loudestId === speakerCandidate) {
					if (now - speakerCandidateStart > SPEAKER_SWITCH_MS) {
						activeSpeakerId = loudestId;
						speakerCandidate = '';
					}
				} else {
					speakerCandidate = loudestId;
					speakerCandidateStart = now;
				}
			} else if (!loudestId) {
				speakerCandidate = '';
			}

			speakerRafId = requestAnimationFrame(pollSpeakers);
		}
		pollSpeakers();
	}

	function updateSpeakerAnalyser(participantId: string, stream: MediaStream | undefined) {
		const existing = speakerAnalysers.get(participantId);
		if (existing) {
			existing.ctx.close().catch(() => {});
			speakerAnalysers.delete(participantId);
		}

		if (!stream || stream.getAudioTracks().length === 0) return;

		try {
			const ctx = new AudioContext();
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 1024;
			analyser.smoothingTimeConstant = 0.5;
			const source = ctx.createMediaStreamSource(stream);
			source.connect(analyser);
			const data = new Float32Array(analyser.fftSize);
			speakerAnalysers.set(participantId, { ctx, analyser, data });
			setupSpeakerDetection();
		} catch (e) {
			console.warn('[Call] Speaker analyser setup failed for', participantId, e);
		}
	}

	function cleanupSpeakerDetection() {
		if (speakerRafId !== null) cancelAnimationFrame(speakerRafId);
		speakerRafId = null;
		for (const [, info] of speakerAnalysers) {
			info.ctx.close().catch(() => {});
		}
		speakerAnalysers.clear();
		speakerLevels.clear();
	}

	$effect(() => {
		if (!browser) return;
		for (const p of room.otherParticipants) {
			const stream = participantStreams.get(p.id);
			if (stream && !speakerAnalysers.has(p.id)) {
				updateSpeakerAnalyser(p.id, stream);
			}
		}
		const currentIds = new Set(room.otherParticipants.map(p => p.id));
		for (const pid of speakerAnalysers.keys()) {
			if (!currentIds.has(pid)) {
				const info = speakerAnalysers.get(pid);
				if (info) info.ctx.close().catch(() => {});
				speakerAnalysers.delete(pid);
			}
		}
		if (!activeSpeakerId || !currentIds.has(activeSpeakerId)) {
			activeSpeakerId = room.otherParticipants[0]?.id || '';
		}
		if (pinnedId && pinnedId !== 'self' && !currentIds.has(pinnedId)) {
			pinnedId = '';
		}
	});

	const screenSharerId = $derived(
		[...screenStreams.keys()].find(id => room.otherParticipants.some(p => p.id === id)) ?? ''
	);

	const focusedIsSelf = $derived(pinnedId === 'self');
	const focusedParticipant = $derived(
		pinnedId && pinnedId !== 'self'
			? room.otherParticipants.find(p => p.id === pinnedId)
			: screenSharerId
				? room.otherParticipants.find(p => p.id === screenSharerId)
				: room.otherParticipants.find(p => p.id === activeSpeakerId)
	);
	const focusedId = $derived(focusedIsSelf ? 'self' : focusedParticipant?.id ?? '');
	const focusedIsScreenShare = $derived(!focusedIsSelf && !!focusedParticipant && screenStreams.has(focusedParticipant.id));
	const thumbnailParticipants = $derived(
		room.otherParticipants.filter(p => p.id !== focusedId)
	);

	$effect(() => {
		if (browser) {
			function handleKey(e: KeyboardEvent) {
				if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
				switch (e.key.toLowerCase()) {
					case 'm':
						media.toggleAudio();
						break;
					case 'v':
						media.toggleVideo();
						break;
					case 'c':
						chatOpen = !chatOpen;
						break;
					case 'escape':
						if (pinnedId) pinnedId = '';
						break;
				}
			}
			window.addEventListener('keydown', handleKey);
			return () => window.removeEventListener('keydown', handleKey);
		}
	});

	onMount(async () => {
		if (!media.stream) {
			await media.init();
		}
		await setupCall();
	});

	onDestroy(() => {
		if (iceRestartTimeout) clearTimeout(iceRestartTimeout);
		stopQualityMonitor();
		cleanupSpeakerDetection();
		leaveCall();
	});

	async function enqueueNegotiation(fn: () => Promise<void>) {
		negotiationQueue.push(fn);
		if (negotiating) return;
		negotiating = true;
		while (negotiationQueue.length > 0) {
			const next = negotiationQueue.shift()!;
			try {
				await next();
			} catch (e) {
				console.error('[Call] Negotiation step failed:', e);
			}
		}
		negotiating = false;
	}

	function rebuildParticipantStreams() {
		if (!pc) return;
		const newCamMap = new Map<string, MediaStream>();
		const newScreenMap = new Map<string, MediaStream>();

		const midToInfo = new Map<string, { pid: string; type: 'audio' | 'video' | 'screen' }>();
		for (const p of room.otherParticipants) {
			if (p.audioTrack) {
				const mid = pulledTracks.get(p.audioTrack);
				if (mid) midToInfo.set(mid, { pid: p.id, type: 'audio' });
			}
			if (p.videoTrack) {
				const mid = pulledTracks.get(p.videoTrack);
				if (mid) midToInfo.set(mid, { pid: p.id, type: 'video' });
			}
			if (p.screenTrack) {
				const mid = pulledTracks.get(p.screenTrack);
				if (mid) midToInfo.set(mid, { pid: p.id, type: 'screen' });
			}
		}

		for (const p of room.otherParticipants) {
			const camTracks: MediaStreamTrack[] = [];
			const scrTracks: MediaStreamTrack[] = [];

			for (const t of pc.getTransceivers()) {
				if (!t.receiver.track || !t.mid) continue;
				const info = midToInfo.get(t.mid);
				if (!info || info.pid !== p.id) continue;

				if (info.type === 'screen') {
					scrTracks.push(t.receiver.track);
				} else {
					camTracks.push(t.receiver.track);
				}
			}

			if (camTracks.length > 0) {
				const existing = participantStreams.get(p.id);
				const existingIds = existing ? new Set(existing.getTracks().map(t => t.id)) : new Set<string>();
				const wantedIds = new Set(camTracks.map(t => t.id));
				const same = existingIds.size === wantedIds.size && [...existingIds].every(id => wantedIds.has(id));
				newCamMap.set(p.id, same && existing ? existing : new MediaStream(camTracks));
			}

			if (scrTracks.length > 0) {
				const existing = screenStreams.get(p.id);
				const existingIds = existing ? new Set(existing.getTracks().map(t => t.id)) : new Set<string>();
				const wantedIds = new Set(scrTracks.map(t => t.id));
				const same = existingIds.size === wantedIds.size && [...existingIds].every(id => wantedIds.has(id));
				newScreenMap.set(p.id, same && existing ? existing : new MediaStream(scrTracks));
			}
		}

		participantStreams = newCamMap;
		screenStreams = newScreenMap;
	}

	function wireUpPeerConnection() {
		if (!pc) return;
		pc.ontrack = (e) => {
			console.log('[Call] Remote track received:', e.track.kind, 'mid:', e.transceiver.mid, 'readyState:', e.track.readyState);
			rebuildParticipantStreams();
			e.track.addEventListener('unmute', () => {
				console.log('[Call] Track unmuted:', e.track.kind, 'mid:', e.transceiver.mid);
				rebuildParticipantStreams();
			}, { once: true });
		};

		pc.oniceconnectionstatechange = () => handleIceStateChange();
	}

	async function setupCall() {
		try {
			sessionId = await createSession();
			console.log('[Call] Session created:', sessionId);
			cfCallsAvailable = true;

			pc = await createPeerConnection();
			media.setPeerConnection(pc);
			wireUpPeerConnection();
			startQualityMonitor();

			if (media.stream) {
				for (const track of media.stream.getTracks()) {
					if (track.kind === 'video') {
						pc.addTransceiver(track, {
							direction: 'sendonly',
							streams: [media.stream],
							sendEncodings: [
								{ rid: 'h', maxBitrate: 1_200_000 },
								{ rid: 'm', maxBitrate: 500_000, scaleResolutionDownBy: 2 },
								{ rid: 'l', maxBitrate: 150_000, scaleResolutionDownBy: 4 }
							]
						});
					} else {
						pc.addTrack(track, media.stream);
					}
				}
			}

			const offer = await pc.createOffer();
			const dtxSdp = enableOpusDtxInSdp(offer.sdp!);
			await pc.setLocalDescription({ ...offer, sdp: dtxSdp });

			const transceivers = pc.getTransceivers();
			const trackMappings: Array<{ trackName: string; mid: string }> = [];

			for (const t of transceivers) {
				if (t.sender.track && t.mid) {
					const trackName = crypto.randomUUID();
					trackMappings.push({ trackName, mid: t.mid });
					if (t.sender.track.kind === 'audio') localAudioTrackName = trackName;
					if (t.sender.track.kind === 'video') localVideoTrackName = trackName;
				}
			}

			const pushResult = await pushLocalTracks(sessionId, dtxSdp, trackMappings);
			console.log('[Call] Push result:', pushResult);

			if (pushResult.sessionDescription) {
				await pc.setRemoteDescription(
					new RTCSessionDescription({
						type: pushResult.sessionDescription.type,
						sdp: pushResult.sessionDescription.sdp
					})
				);
			}
		} catch (e: any) {
			console.warn('[Call] CF Calls setup failed (media relay unavailable):', e.message);
			callError = 'Media relay unavailable. Presence and chat still work. Set CF_CALLS_APP_ID and CF_CALLS_APP_SECRET for full video.';
			cfCallsAvailable = false;
		}

		connectToRoom();
	}

	function connectToRoom() {
		const roomCleanup = room.connect(ROOM_SERVER_URL, roomId);

		room.join(userName, sessionId, clientId, localAudioTrackName, localVideoTrackName);

		const unsubMsg = room.onMessage(async (msg: ServerMessage) => {
			if (msg.type === 'snapshot') {
				for (const p of msg.participants) {
					if (p.id !== room.myId) {
						await pullParticipantTracks(p);
					}
				}
			}
			if (msg.type === 'participant-joined') {
				await pullParticipantTracks(msg.participant);
			}
			if (msg.type === 'track-updated') {
				if (msg.participantId !== room.myId) {
					const p = room.participants.find((x) => x.id === msg.participantId);
					if (p) {
						const updatedP: Participant = {
							...p,
							audioTrack: msg.audioTrack ?? p.audioTrack,
							videoTrack: msg.videoTrack ?? p.videoTrack,
							screenTrack: msg.screenTrack ?? p.screenTrack
						};
						const newTracks = new Set([updatedP.audioTrack, updatedP.videoTrack, updatedP.screenTrack].filter(Boolean));
						for (const [trackName] of pulledTracks) {
							if (!newTracks.has(trackName)) {
								pulledTracks.delete(trackName);
							}
						}
						pulledTracks = new Map(pulledTracks);
						console.log('[Call] track-updated for', p.name, '- screen:', updatedP.screenTrack);
						await pullParticipantTracks(updatedP);
					}
				}
			}
			if (msg.type === 'participant-left') {
				console.log('[Call] Participant left:', msg.participantId);
				participantStreams.delete(msg.participantId);
				participantStreams = new Map(participantStreams);
				screenStreams.delete(msg.participantId);
				screenStreams = new Map(screenStreams);
			}
		});

		window.addEventListener('beforeunload', handleBeforeUnload);

		cleanup = () => {
			roomCleanup();
			unsubMsg();
			window.removeEventListener('beforeunload', handleBeforeUnload);
		};
	}

	async function pullParticipantTracks(p: Participant) {
		if (!pc || !sessionId || !cfCallsAvailable) return;

		const tracksToPull: Array<{ sessionId: string; trackName: string }> = [];

		if (p.audioTrack && !pulledTracks.has(p.audioTrack)) {
			tracksToPull.push({ sessionId: p.sessionId, trackName: p.audioTrack });
		}
		if (p.videoTrack && !pulledTracks.has(p.videoTrack)) {
			tracksToPull.push({ sessionId: p.sessionId, trackName: p.videoTrack });
		}
		if (p.screenTrack && !pulledTracks.has(p.screenTrack)) {
			tracksToPull.push({ sessionId: p.sessionId, trackName: p.screenTrack });
		}

		if (tracksToPull.length === 0) return;

		await enqueueNegotiation(async () => {
			if (!pc || !sessionId) return;
			try {
				console.log('[Call] Pulling tracks for', p.name, ':', tracksToPull.map(t => t.trackName));
				const pullResult = await pullRemoteTracks(sessionId, tracksToPull);
				console.log('[Call] Pull result:', pullResult);

				if (pullResult.tracks) {
					for (const t of pullResult.tracks) {
						if (t.mid && t.trackName) {
							pulledTracks = new Map(pulledTracks.set(t.trackName, t.mid));
						}
						if (t.errorCode) {
							console.error('[Call] Track pull error:', t.trackName, t.errorCode, t.errorDescription);
						}
					}
				}

				if (pullResult.requiresImmediateRenegotiation && pullResult.sessionDescription) {
					await pc.setRemoteDescription(
						new RTCSessionDescription({
							type: pullResult.sessionDescription.type,
							sdp: pullResult.sessionDescription.sdp
						})
					);
					const answer = await pc.createAnswer();
					await pc.setLocalDescription(answer);
					await renegotiate(sessionId, answer.sdp!);
					console.log('[Call] Renegotiation complete for', p.name);
				}

				rebuildParticipantStreams();
			} catch (e) {
				console.error('[Call] Pull failed for participant:', p.id, e);
			}
		});
	}

	function handleBeforeUnload() {
		room.leave();
		if (pc) {
			pc.close();
			pc = null;
		}
		media.cleanup();
	}

	function leaveCall() {
		stopQualityMonitor();
		cleanup?.();
		room.leave();
		media.setPeerConnection(null);
		if (pc) {
			pc.close();
			pc = null;
		}
		media.cleanup();
	}

	async function handleLeave() {
		leaveCall();
		goto('/');
	}

	async function handleToggleScreen() {
		if (media.screenEnabled) {
			const screenTrack = media.screenStream?.getVideoTracks()[0];

			await media.toggleScreen();
			room.updateTracks(localAudioTrackName, localVideoTrackName, '');

			await enqueueNegotiation(async () => {
				if (!pc || !sessionId) return;
				if (localScreenMid) {
					try {
						await closeTracks(sessionId, [localScreenMid], true);
					} catch (e) {
						console.error('[Call] Failed to close screen track:', e);
					}
				}
				if (screenTrack) {
					const sender = pc.getSenders().find((s) => s.track === screenTrack);
					if (sender) pc.removeTrack(sender);
				}
				localScreenTrackName = '';
				localScreenMid = '';
			});
			return;
		}

		await media.toggleScreen();

		if (media.screenEnabled && media.screenStream && pc) {
			const screenTrack = media.screenStream.getVideoTracks()[0];
			if (!screenTrack) return;

			await enqueueNegotiation(async () => {
				if (!pc || !sessionId) return;

				pc.addTrack(screenTrack, media.screenStream!);

				const offer = await pc.createOffer();
				await pc.setLocalDescription(offer);

				const transceivers = pc.getTransceivers();
				const screenTransceiver = transceivers.find(
					(t) => t.sender.track === screenTrack && t.mid
				);

				if (screenTransceiver?.mid) {
					const trackName = crypto.randomUUID();
					localScreenTrackName = trackName;
					localScreenMid = screenTransceiver.mid;

					const pushResult = await pushLocalTracks(sessionId, offer.sdp!, [
						{ trackName, mid: screenTransceiver.mid }
					]);

					if (pushResult.sessionDescription) {
						await pc.setRemoteDescription(
							new RTCSessionDescription({
								type: pushResult.sessionDescription.type,
								sdp: pushResult.sessionDescription.sdp
							})
						);
					}

					room.updateTracks(localAudioTrackName, localVideoTrackName, localScreenTrackName);
					console.log('[Call] Screen share published:', trackName, 'mid:', screenTransceiver.mid);
				}
			});

			screenTrack.addEventListener('ended', () => {
				handleToggleScreen();
			});
		}
	}

	const hasRemotes = $derived(room.otherParticipants.length > 0);
	let inviteVisible = $state(false);
	let controlBarRef: ControlBar;

	function setScreenSrc(el: HTMLVideoElement, stream: MediaStream) {
		el.srcObject = stream;
		return {
			update(newStream: MediaStream) {
				if (el.srcObject !== newStream) el.srcObject = newStream;
			},
			destroy() {
				el.srcObject = null;
			}
		};
	}
</script>

<div class="flex h-dvh flex-col bg-base">
	<div class="flex flex-1 flex-col overflow-hidden transition-[margin] duration-300 ease-in-out {chatOpen ? 'sm:mr-80' : 'mr-0'}">
		<!-- Self-view strip (only when others are present and self isn't focused) -->
		{#if hasRemotes && !focusedIsSelf}
			<div class="flex shrink-0 items-center justify-center gap-2 px-2 py-1.5 sm:px-4 sm:py-2">
				<button
					onclick={() => { pinnedId = 'self'; }}
					class="h-16 w-24 sm:h-[5.5rem] sm:w-36 cursor-pointer transition-transform duration-150 hover:scale-[1.03]"
					title="Click to maximise your view"
				>
					<VideoTile
						stream={media.stream}
						name="{userName} (You)"
						muted={true}
						mirror={true}
						showAudioLevel={true}
						size="sm"
					/>
				</button>
				{#if media.screenEnabled && media.screenStream}
					<div class="relative hidden sm:block h-[5.5rem] w-36 overflow-hidden rounded-lg ring-1 ring-accent/30">
						<video
							autoplay
							playsinline
							muted
							class="h-full w-full object-contain bg-black"
							use:setScreenSrc={media.screenStream}
						></video>
						<div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4">
							<span class="text-[11px] text-accent font-medium">Screen share</span>
						</div>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Main area -->
		<div class="relative flex-1 overflow-hidden px-1 pb-1 sm:px-3 sm:pb-3">
			{#if !hasRemotes}
				<!-- Alone: full self-view with invite pill -->
				<div class="h-full w-full">
					<VideoTile
						stream={media.stream}
						name="{userName} (You)"
						muted={true}
						mirror={true}
						showAudioLevel={true}
						size="lg"
					/>
				</div>
				{#if !inviteVisible}
					<div class="pointer-events-none absolute inset-0 flex items-end justify-center pb-24 sm:pb-28">
						<button
							onclick={() => controlBarRef?.openInvite()}
							class="pointer-events-auto flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.08] bg-black/50 px-4 py-2.5 outline-none backdrop-blur-sm transition-all duration-150 hover:border-white/[0.14] hover:bg-black/60"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-accent">
								<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>
							</svg>
							<span class="text-[13px] text-text-secondary">Invite someone to join</span>
						</button>
					</div>
				{/if}
			{:else if focusedIsSelf}
				<div class="h-full w-full {thumbnailParticipants.length > 0 ? 'pb-24' : ''}">
					<VideoTile
						stream={media.stream}
						name="{userName} (You)"
						muted={true}
						mirror={true}
						showAudioLevel={true}
						size="lg"
					/>
				</div>
				{@render unpinButton('Minimise')}

				{#if room.otherParticipants.length > 0}
					{@render thumbnailStrip(room.otherParticipants)}
				{/if}
			{:else if focusedParticipant}
				<div class="h-full w-full {thumbnailParticipants.length > 0 ? 'pb-24' : ''}">
					{#if focusedIsScreenShare}
						<VideoTile
							stream={screenStreams.get(focusedParticipant.id) || null}
							name="{focusedParticipant.name}'s screen"
							size="lg"
						/>
						<div class="absolute top-4 left-4 z-10 h-24 w-36">
							<VideoTile
								stream={participantStreams.get(focusedParticipant.id) || null}
								name={focusedParticipant.name}
								size="sm"
							/>
						</div>
					{:else}
						<VideoTile
							stream={participantStreams.get(focusedParticipant.id) || null}
							name={focusedParticipant.name}
							size="lg"
						/>
					{/if}
				</div>

				{#if pinnedId}
					{@render unpinButton('Auto')}
				{/if}

				{#if thumbnailParticipants.length > 0}
					{@render thumbnailStrip(thumbnailParticipants)}
				{/if}
			{/if}
		</div>
	</div>

	<ControlBar
		bind:this={controlBarRef}
		audioEnabled={media.audioEnabled}
		videoEnabled={media.videoEnabled}
		screenEnabled={media.screenEnabled}
		{chatOpen}
		{unreadChat}
		{roomId}
		showInvite={!hasRemotes}
		mics={media.mics}
		cameras={media.cameras}
		speakers={media.speakers}
		selectedMic={media.selectedMic}
		selectedCamera={media.selectedCamera}
		selectedSpeaker={media.selectedSpeaker}
		{connectionQuality}
		onToggleAudio={() => media.toggleAudio()}
		onToggleVideo={() => media.toggleVideo()}
		onToggleScreen={handleToggleScreen}
		onToggleChat={() => (chatOpen = !chatOpen)}
		onLeave={handleLeave}
		onSwitchMic={(id) => media.switchMic(id)}
		onSwitchCamera={(id) => media.switchCamera(id)}
		onSwitchSpeaker={(id) => media.switchSpeaker(id)}
		onInviteOpenChange={(open) => { inviteVisible = open; }}
	/>

	<ChatPanel
		open={chatOpen}
		messages={room.chatMessages}
		myId={room.myId}
		onSend={(text) => room.sendChat(text)}
		onClose={() => (chatOpen = false)}
	/>

	{#if reconnecting}
		<div class="fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-50 -translate-x-1/2 w-[calc(100%-2rem)] sm:w-auto">
			<div class="flex items-center justify-center gap-2 rounded-xl border border-yellow-500/20 bg-surface/95 px-3 sm:px-4 py-2 text-[12px] sm:text-[13px] text-yellow-400 shadow-lg backdrop-blur-xl">
				<svg class="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
					<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" opacity="0.25"/>
					<path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
				</svg>
				Reconnecting...
			</div>
		</div>
	{:else if !room.connected}
		<div class="fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-50 -translate-x-1/2 w-[calc(100%-2rem)] sm:w-auto">
			<div class="rounded-xl border border-white/[0.08] bg-surface/95 px-3 sm:px-4 py-2 text-center text-[12px] sm:text-[13px] text-text-secondary shadow-lg backdrop-blur-xl">
				Connecting to room...
			</div>
		</div>
	{/if}

	{#if callError}
		<div class="fixed left-1/2 z-50 -translate-x-1/2 w-[calc(100%-2rem)] sm:w-auto {reconnecting || !room.connected ? 'top-14' : 'top-[max(0.75rem,env(safe-area-inset-top))]'}">
			<div class="rounded-xl border border-yellow-500/20 bg-surface/95 px-3 sm:px-4 py-2 text-center text-[12px] sm:text-[13px] text-yellow-400 shadow-lg backdrop-blur-xl">
				{callError}
			</div>
		</div>
	{/if}
</div>

{#snippet unpinButton(label: string)}
	<button
		onclick={() => { pinnedId = ''; }}
		class="absolute top-4 right-4 z-10 flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/[0.08] bg-black/50 px-2.5 py-1.5 text-[12px] font-medium text-white/70 backdrop-blur-sm transition-all duration-150 hover:bg-black/70 hover:text-white active:scale-95"
		title="Back to auto speaker view"
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
		{label}
	</button>
{/snippet}

{#snippet thumbnailStrip(participants: import('$lib/room/protocol').Participant[])}
	<div class="absolute bottom-1.5 left-1.5 right-1.5 sm:bottom-3 sm:left-3 sm:right-3 flex justify-center gap-1 sm:gap-1.5 overflow-x-auto">
		{#each participants as p (p.id)}
			<button
				onclick={() => { pinnedId = p.id; }}
				class="h-16 w-24 sm:h-20 sm:w-32 flex-shrink-0 cursor-pointer transition-transform duration-150 hover:scale-[1.04]"
			>
				<VideoTile
					stream={participantStreams.get(p.id) || null}
					name={p.name}
					size="md"
				/>
			</button>
		{/each}
	</div>
{/snippet}
