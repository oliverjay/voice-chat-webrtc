<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { media } from '$lib/stores/media.svelte';
	import { room } from '$lib/stores/room.svelte';
	import { loadPreferences, getClientId } from '$lib/utils/preferences';
	import { generateRandomName } from '$lib/utils/names';
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
		enableOpusDtxInSdp,
		updateTrackSimulcast,
		type SimulcastPrefs
	} from '$lib/webrtc/session';
	import type { Participant, ServerMessage } from '$lib/room/protocol';
	import { AgentManager, type AgentState } from '$lib/agents/agent-manager';
	import { personas, getPersona } from '$lib/agents/personas';
	import { wakeDirectPrompt } from '$lib/agents/wake';
	import { stopActiveSpeechRecognition } from '$lib/utils/speech-recognition';

	const agentManager = new AgentManager();
	let agentStates = $state<Map<string, AgentState>>(new Map());
	let activeAgentSlugs = $state<Set<string>>(new Set());
	let loadingAgents = $state<Set<string>>(new Set());
	let agentTypingIds = $state<Set<string>>(new Set());
	let recentlyJoinedAgents = $state<Set<string>>(new Set());
	const rehydratingAgents = new Set<string>();

	let agentParticipantIds = $derived(() => {
		const ids = new Set<string>();
		for (const p of room.participants) {
			if (p.isAgent) ids.add(p.id);
		}
		return ids;
	});

	let agentNames = $derived(() => {
		const map = new Map<string, string>();
		for (const p of room.participants) {
			if (p.isAgent) map.set(p.id, p.name);
		}
		return map;
	});

	let agentWakeTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingWakeOnReady: { slug: string; prompt: string } | null = null;

	function evaluateAgentWake() {
		const msgs = room.chatMessages;
		const allKnownSlugs = new Set([...activeAgentSlugs, ...loadingAgents, ...rehydratingAgents]);
		if (msgs.length === 0 || allKnownSlugs.size === 0) return;

		const agentIds = agentParticipantIds();

		// Find the last human message — the debounce was triggered by a human chat-message,
		// but an agent response may have arrived during the delay.
		let lastHumanIdx = msgs.length - 1;
		while (lastHumanIdx >= 0 && agentIds.has(msgs[lastHumanIdx].participantId)) {
			lastHumanIdx--;
		}
		if (lastHumanIdx < 0) return;

		// Collect all human messages in the most recent unbroken human run
		// (scan backwards from lastHumanIdx, stopping at any agent message).
		let burstStart = lastHumanIdx;
		while (burstStart > 0 && !agentIds.has(msgs[burstStart - 1].participantId)) {
			burstStart--;
		}
		const humanBurst = msgs.slice(burstStart, lastHumanIdx + 1);
		if (humanBurst.length === 0) return;

		const burstCombined = humanBurst.map(x => x.text).join('\n');
		const lastHumanText = humanBurst[humanBurst.length - 1].text;

		// 1. Direct wake: check if any agent is addressed by name (fuzzy).
		//    If multiple agents are named, trigger all of them.
		let wakeTriggered = false;
		for (const slug of allKnownSlugs) {
			const persona = getPersona(slug);
			if (!persona) continue;

			const direct = wakeDirectPrompt(burstCombined, persona) ?? wakeDirectPrompt(lastHumanText, persona);
			if (direct !== null) {
				wakeTriggered = true;
				if (activeAgentSlugs.has(slug)) {
					console.log('[Call] Wake prompt for', persona.name, ':', direct.slice(0, 120));
					void agentManager.triggerResponse(slug, room.chatMessages, agentIds, false, {
						lastMessageOverride: direct
					});
				} else {
					console.log('[Call] Wake queued for loading agent', persona.name, ':', direct.slice(0, 120));
					pendingWakeOnReady = { slug, prompt: direct };
				}
			}
		}
		if (wakeTriggered) return;

		// 2. Follow-up: find the most recent agent message before the human burst.
		//    This is a conversational continuation (user replying to the agent without re-naming it).
		for (let i = burstStart - 1; i >= 0; i--) {
			const prev = msgs[i];
			if (agentIds.has(prev.participantId)) {
				const agent = agentManager.getAgentByParticipantId(prev.participantId);
				if (agent) {
					console.log('[Call] Agent follow-up for', agent.persona.name, ':', burstCombined.slice(0, 120));
					void agentManager.triggerResponse(agent.persona.slug, room.chatMessages, agentIds, false);
				}
				return;
			}
		}
	}

	agentManager.setOnStateChange((slug, state) => {
		agentStates = new Map(agentStates.set(slug, state));
	});

	function getAgentStateForParticipant(p: Participant): AgentState {
		if (!p.isAgent) return 'idle';
		for (const [slug, agent] of [...activeAgentSlugs].map(s => [s, agentManager.getAgent(s)] as const)) {
			if (agent && agent.participantId === p.id) {
				return agentStates.get(slug) ?? 'idle';
			}
		}
		return 'idle';
	}

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
		userName = loadPreferences().name || generateRandomName();
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

	const SIMULCAST_HIGH: SimulcastPrefs = { preferredRid: 'h', priorityOrdering: 'asciibetical', ridNotAvailable: 'asciibetical' };
	const SIMULCAST_LOW: SimulcastPrefs = { preferredRid: 'l', priorityOrdering: 'asciibetical', ridNotAvailable: 'asciibetical' };
	let videoTrackMids = new Map<string, { mid: string; pSessionId: string; trackName: string }>();
	let currentSimulcastLayer = new Map<string, string>();

	let activeSpeakerId = $state<string>('');
	let pinnedId = $state<string>('');
	let speakerLevels = new Map<string, number>();
	let speakerCandidate = '';
	let speakerCandidateStart = 0;

	let sharedAudioCtx: AudioContext | null = null;
	let speakerSources = new Map<string, { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; data: Float32Array<ArrayBuffer> }>();
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

	function ensureSharedAudioCtx(): AudioContext {
		if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
			sharedAudioCtx = new AudioContext();
		}
		return sharedAudioCtx;
	}

	function setupSpeakerDetection() {
		if (speakerRafId !== null) return;

		function pollSpeakers() {
			const now = Date.now();
			let loudestId = '';
			let loudestLevel = 0;

			for (const [pid, info] of speakerSources) {
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
		const existing = speakerSources.get(participantId);
		if (existing) {
			try { existing.source.disconnect(); } catch {}
			speakerSources.delete(participantId);
		}

		if (!stream || stream.getAudioTracks().length === 0) return;

		try {
			const ctx = ensureSharedAudioCtx();
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 1024;
			analyser.smoothingTimeConstant = 0.5;
			const source = ctx.createMediaStreamSource(stream);
			source.connect(analyser);
			const data = new Float32Array(analyser.fftSize);
			speakerSources.set(participantId, { source, analyser, data });
			setupSpeakerDetection();
		} catch (e) {
			console.warn('[Call] Speaker analyser setup failed for', participantId, e);
		}
	}

	function cleanupSpeakerDetection() {
		if (speakerRafId !== null) cancelAnimationFrame(speakerRafId);
		speakerRafId = null;
		for (const [, info] of speakerSources) {
			try { info.source.disconnect(); } catch {}
		}
		speakerSources.clear();
		speakerLevels.clear();
		if (sharedAudioCtx) {
			sharedAudioCtx.close().catch(() => {});
			sharedAudioCtx = null;
		}
	}

	$effect(() => {
		if (!browser) return;
		for (const p of room.otherParticipants) {
			const stream = participantStreams.get(p.id);
			if (stream && !speakerSources.has(p.id)) {
				updateSpeakerAnalyser(p.id, stream);
			}
		}
		const currentIds = new Set(room.otherParticipants.map(p => p.id));
		for (const pid of speakerSources.keys()) {
			if (!currentIds.has(pid)) {
				const info = speakerSources.get(pid);
				if (info) { try { info.source.disconnect(); } catch {} }
				speakerSources.delete(pid);
			}
		}
		if (!activeSpeakerId || !currentIds.has(activeSpeakerId)) {
			activeSpeakerId = room.otherParticipants[0]?.id || '';
		}
		if (pinnedId && pinnedId !== 'self' && !currentIds.has(pinnedId)) {
			pinnedId = '';
		}
	});

	const selfScreenSharing = $derived(media.screenEnabled && !!media.screenStream);

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
		if (!browser || !sessionId || !cfCallsAvailable) return;
		const fid = focusedId;
		const updates: Array<{ mid: string; sessionId: string; trackName: string; simulcast: SimulcastPrefs }> = [];

		for (const [pid, info] of videoTrackMids) {
			const wantRid = pid === fid ? 'h' : 'l';
			const currentRid = currentSimulcastLayer.get(pid);
			if (currentRid !== wantRid) {
				currentSimulcastLayer.set(pid, wantRid);
				updates.push({
					mid: info.mid,
					sessionId: info.pSessionId,
					trackName: info.trackName,
					simulcast: pid === fid ? SIMULCAST_HIGH : SIMULCAST_LOW
				});
			}
		}

		if (updates.length > 0) {
			console.log('[Call] Updating simulcast layers:', updates.map(u => `${u.trackName}→${u.simulcast.preferredRid}`));
			updateTrackSimulcast(sessionId, updates);
		}
	});

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
		if (agentWakeTimer) clearTimeout(agentWakeTimer);
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
			requestAnimationFrame(() => media.applySpeakerToElements());
			e.track.addEventListener('unmute', () => {
				console.log('[Call] Track unmuted:', e.track.kind, 'mid:', e.transceiver.mid);
				rebuildParticipantStreams();
				requestAnimationFrame(() => media.applySpeakerToElements());
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
		agentManager.setChatContext(
			() => room.chatMessages,
			() => agentParticipantIds()
		);
		const unsubMsg = room.onMessage(async (msg: ServerMessage) => {
			console.log('[Call] Room message:', msg.type,
				msg.type === 'snapshot' ? `(${msg.participants.length} participants, myId=${msg.yourId})` :
				msg.type === 'participant-joined' ? `(${msg.participant.name})` : '');
			if (msg.type === 'snapshot') {
				const others = msg.participants.filter((p: any) => p.id !== msg.yourId);
				console.log('[Call] Snapshot others:', others.map((p: any) => `${p.name} (session=${p.sessionId?.slice(0,8)}, audio=${p.audioTrack}, video=${p.videoTrack})`));
				for (const p of msg.participants) {
					if (p.id !== room.myId && !p.isAgent) {
						console.log('[Call] Pulling tracks for snapshot participant:', p.name, { audio: p.audioTrack, video: p.videoTrack, screen: p.screenTrack });
						await pullParticipantTracks(p);
					}
				}

				// Re-hydrate agents that were active before disconnect
				const serverAgentSlugs = msg.activeAgentSlugs || [];
				for (const slug of serverAgentSlugs) {
					if (!activeAgentSlugs.has(slug) && !loadingAgents.has(slug)) {
						console.log('[Call] Re-hydrating agent:', slug);
						rehydratingAgents.add(slug);
						handleAddAgent(slug);
					}
				}
			}
			if (msg.type === 'participant-joined') {
				console.log('[Call] New participant:', msg.participant.name, { audio: msg.participant.audioTrack, video: msg.participant.videoTrack });
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
				videoTrackMids.delete(msg.participantId);
				currentSimulcastLayer.delete(msg.participantId);
			}
			if (msg.type === 'agent-joined-ack') {
				const ackMsg = msg;
				const pendingSlug = ackMsg.agentSlug || [...loadingAgents].find(slug => {
					const persona = getPersona(slug);
					return persona && !activeAgentSlugs.has(slug);
				});
				if (pendingSlug) {
					const isRehydrate = rehydratingAgents.has(pendingSlug);
					agentManager.setAgentParticipantId(pendingSlug, ackMsg.participantId);
					activeAgentSlugs = new Set([...activeAgentSlugs, pendingSlug]);
					loadingAgents = new Set([...loadingAgents].filter(s => s !== pendingSlug));
					rehydratingAgents.delete(pendingSlug);
					recentlyJoinedAgents = new Set([...recentlyJoinedAgents, ackMsg.participantId]);
					setTimeout(() => {
						recentlyJoinedAgents = new Set([...recentlyJoinedAgents].filter(id => id !== ackMsg.participantId));
					}, 500);

					await pushAgentAudioTrack(pendingSlug);
					if (!isRehydrate) {
						agentManager.triggerResponse(pendingSlug, room.chatMessages, agentParticipantIds(), true);
					} else if (pendingWakeOnReady?.slug === pendingSlug) {
						const wake = pendingWakeOnReady;
						pendingWakeOnReady = null;
						console.log('[Call] Flushing queued wake for', pendingSlug, ':', wake.prompt.slice(0, 120));
						void agentManager.triggerResponse(pendingSlug, room.chatMessages, agentParticipantIds(), false, {
							lastMessageOverride: wake.prompt
						});
					}
				}
			}
			if (msg.type === 'agent-typing') {
				agentTypingIds = new Set([...agentTypingIds, msg.participantId]);
			}
			if (msg.type === 'agent-done') {
				agentTypingIds = new Set([...agentTypingIds].filter(id => id !== msg.participantId));
			}
			if (msg.type === 'chat-message') {
				const m = msg.message;
				if (agentParticipantIds().has(m.participantId)) return;
				const anyAgents = activeAgentSlugs.size > 0 || loadingAgents.size > 0 || rehydratingAgents.size > 0;
				if (!anyAgents) return;

				if (agentWakeTimer) clearTimeout(agentWakeTimer);
				agentWakeTimer = setTimeout(() => {
					agentWakeTimer = null;
					evaluateAgentWake();
				}, 1500);
			}
		});

		room.connect(ROOM_SERVER_URL, roomId);
		room.join(userName, sessionId, clientId, localAudioTrackName, localVideoTrackName);

		window.addEventListener('beforeunload', handleBeforeUnload);

		cleanup = () => {
			room.disconnect();
			unsubMsg();
			window.removeEventListener('beforeunload', handleBeforeUnload);
		};
	}

	function getSimulcastForParticipant(pid: string): SimulcastPrefs {
		const isFocused = focusedId === pid;
		return isFocused ? SIMULCAST_HIGH : SIMULCAST_LOW;
	}

	async function pullParticipantTracks(p: Participant) {
		if (!pc || !sessionId || !cfCallsAvailable) return;

		const tracksToPull: Array<{ sessionId: string; trackName: string; simulcast?: SimulcastPrefs }> = [];

		if (p.audioTrack && !pulledTracks.has(p.audioTrack)) {
			tracksToPull.push({ sessionId: p.sessionId, trackName: p.audioTrack });
		}
		if (p.videoTrack && !pulledTracks.has(p.videoTrack)) {
			const simulcast = getSimulcastForParticipant(p.id);
			tracksToPull.push({ sessionId: p.sessionId, trackName: p.videoTrack, simulcast });
			currentSimulcastLayer.set(p.id, simulcast.preferredRid);
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
							if (p.videoTrack === t.trackName) {
								videoTrackMids.set(p.id, { mid: t.mid, pSessionId: p.sessionId, trackName: t.trackName });
							}
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
		stopActiveSpeechRecognition();
		agentManager.cleanup();
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
		goto(`/${roomId}`);
	}

	async function cleanupScreenShare() {
		const screenTrack = media.screenStream?.getVideoTracks()[0];
		const screenSender = screenTrack && pc
			? pc.getSenders().find((s) => s.track === screenTrack)
			: null;

		if (media.screenEnabled) await media.toggleScreen();
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
			if (screenSender) pc.removeTrack(screenSender);
			localScreenTrackName = '';
			localScreenMid = '';
		});
	}

	async function handleToggleScreen() {
		if (media.screenEnabled) {
			await cleanupScreenShare();
			return;
		}

		await media.toggleScreen();

		if (media.screenEnabled && media.screenStream && pc) {
			const screenTrack = media.screenStream.getVideoTracks()[0];
			if (!screenTrack) return;

			await enqueueNegotiation(async () => {
				if (!pc || !sessionId) return;

				const screenTransceiver = pc.addTransceiver(screenTrack, {
					direction: 'sendonly',
					streams: [media.screenStream!]
				});

				const offer = await pc.createOffer();
				await pc.setLocalDescription(offer);

				if (screenTransceiver.mid) {
					const trackName = crypto.randomUUID();
					localScreenTrackName = trackName;
					localScreenMid = screenTransceiver.mid;

					const allTrackMappings: Array<{ trackName: string; mid: string }> = [
						{ trackName, mid: screenTransceiver.mid }
					];

					for (const t of pc.getTransceivers()) {
						if (t === screenTransceiver || !t.sender.track || !t.mid) continue;
						const existingName =
							t.sender.track.kind === 'audio' ? localAudioTrackName :
							t.sender.track.kind === 'video' ? localVideoTrackName : '';
						if (existingName) {
							allTrackMappings.push({ trackName: existingName, mid: t.mid });
						}
					}

					const pushResult = await pushLocalTracks(sessionId, offer.sdp!, allTrackMappings);

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
				console.log('[Call] Screen track ended (native stop)');
				cleanupScreenShare();
			});
		}
	}

	const hasRemotes = $derived(room.otherParticipants.length > 0);
	/** Subscribe to room chat in this component so ChatPanel updates when the store changes. */
	const chatPanelMessages = $derived(room.chatMessages);
	let controlBarRef: ControlBar;

	async function handleAddAgent(slug: string) {
		const persona = getPersona(slug);
		if (!persona || activeAgentSlugs.has(slug)) return;

		loadingAgents = new Set([...loadingAgents, slug]);

		agentManager.setSocket(room.socket);
		agentManager.setPeerConnection(pc);
		agentManager.setHostSessionId(sessionId);

		const trackName = await agentManager.addAgent(persona);
		if (!trackName) {
			loadingAgents = new Set([...loadingAgents].filter(s => s !== slug));
			return;
		}
	}

	function handleRemoveAgent(slug: string) {
		agentManager.removeAgent(slug);
		activeAgentSlugs = new Set([...activeAgentSlugs].filter(s => s !== slug));
		agentStates = new Map([...agentStates].filter(([s]) => s !== slug));
	}

	function handleChatSend(text: string) {
		room.sendChat(text);
	}

	async function pushAgentAudioTrack(slug: string) {
		if (!pc || !sessionId || !cfCallsAvailable) return;

		const trackInfo = agentManager.getTrackForAgent(slug);
		if (!trackInfo) return;

		await enqueueNegotiation(async () => {
			if (!pc || !sessionId) return;

			pc.addTransceiver(trackInfo.track, { direction: 'sendonly' });

			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);

			const allTrackMappings: Array<{ trackName: string; mid: string }> = [];
			for (const t of pc.getTransceivers()) {
				if (!t.sender.track || !t.mid) continue;
				if (t.sender.track === trackInfo.track) {
					allTrackMappings.push({ trackName: trackInfo.trackName, mid: t.mid });
				} else {
					const existingName =
						t.sender.track.kind === 'audio' ? localAudioTrackName :
						t.sender.track.kind === 'video' ? localVideoTrackName :
						localScreenTrackName;
					if (existingName) {
						allTrackMappings.push({ trackName: existingName, mid: t.mid });
					}
				}
			}

			const pushResult = await pushLocalTracks(sessionId, offer.sdp!, allTrackMappings);
			if (pushResult.sessionDescription) {
				await pc.setRemoteDescription(new RTCSessionDescription({
					type: pushResult.sessionDescription.type,
					sdp: pushResult.sessionDescription.sdp
				}));
			}

			const agent = agentManager.getAgent(slug);
			if (agent && room.socket) {
				room.socket.send({
					type: 'track-update-agent',
					participantId: agent.participantId,
					audioTrack: trackInfo.trackName,
					sessionId: sessionId
				} as any);
			}

			console.log('[Call] Agent audio track pushed for', slug);
		});
	}

</script>

<div class="flex h-dvh flex-col bg-base">
	<div class="flex flex-1 flex-col overflow-hidden transition-[margin] duration-300 ease-in-out {chatOpen ? 'sm:mr-80' : 'mr-0'}">
		<!-- Top strip: self-view (default) or other participants (when self is focused) -->
		{#if hasRemotes && !selfScreenSharing}
			{#if focusedIsSelf}
				<div class="flex shrink-0 items-center justify-center gap-2 px-2 py-1.5 sm:px-4 sm:py-2 overflow-x-auto">
					{#each room.otherParticipants as p (p.id)}
						<button
							onclick={() => { pinnedId = p.id; }}
							class="h-16 w-24 sm:h-[5.5rem] sm:w-36 flex-shrink-0 cursor-pointer transition-transform duration-150 hover:scale-[1.03]
								{recentlyJoinedAgents.has(p.id) ? 'animate-agent-entrance' : ''}"
							title="Click to focus {p.name}"
						>
							<VideoTile
								stream={participantStreams.get(p.id) || null}
								name={p.name}
								size="sm"
								isAgent={!!p.isAgent}
								avatarUrl={p.avatarUrl || ''}
								agentState={getAgentStateForParticipant(p)}
							/>
						</button>
					{/each}
				</div>
			{:else}
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
						videoOff={!media.videoEnabled}
					/>
					</button>
				</div>
			{/if}
		{/if}

		<!-- Main area -->
		<div class="relative flex-1 overflow-hidden px-1 pb-1 sm:px-3 sm:pb-3">
			{#if selfScreenSharing}
				<!-- Self screen sharing: screen as main, face in circle corner -->
				<div class="h-full w-full {hasRemotes && thumbnailParticipants.length > 0 ? 'pb-24' : ''}">
					<VideoTile
						stream={media.screenStream}
						name="Your screen"
						muted={true}
						contain={true}
						size="lg"
					/>
				</div>
				<div class="absolute bottom-20 right-4 sm:bottom-24 sm:right-6 z-10 h-20 w-20 sm:h-28 sm:w-28">
					<VideoTile
						stream={media.stream}
						name="{userName}"
						muted={true}
						mirror={true}
						circular={true}
						size="sm"
						videoOff={!media.videoEnabled}
					/>
				</div>
				{#if hasRemotes && thumbnailParticipants.length > 0}
					{@render thumbnailStrip(thumbnailParticipants)}
				{/if}
			{:else if !hasRemotes}
				<!-- Alone, no screen share: full self-view -->
				<div class="h-full w-full">
					<VideoTile
						stream={media.stream}
						name="{userName} (You)"
						muted={true}
						mirror={true}
						showAudioLevel={true}
						size="lg"
						videoOff={!media.videoEnabled}
					/>
				</div>
		{:else if focusedIsSelf}
				<div class="h-full w-full">
					<VideoTile
						stream={media.stream}
						name="{userName} (You)"
						muted={true}
						mirror={true}
						showAudioLevel={true}
						size="lg"
						videoOff={!media.videoEnabled}
					/>
				</div>
				{@render unpinButton('Minimise')}
			{:else if focusedParticipant}
				<div class="h-full w-full {thumbnailParticipants.length > 0 ? 'pb-24' : ''}">
					{#if focusedIsScreenShare}
						<!-- Remote screen share: screen as main (contained), face in circle corner -->
						<VideoTile
							stream={screenStreams.get(focusedParticipant.id) || null}
							name="{focusedParticipant.name}'s screen"
							contain={true}
							size="lg"
						/>
						<div class="absolute bottom-20 right-4 sm:bottom-24 sm:right-6 z-10 h-20 w-20 sm:h-28 sm:w-28">
							<VideoTile
								stream={participantStreams.get(focusedParticipant.id) || null}
								name={focusedParticipant.name}
								circular={true}
								size="sm"
							/>
						</div>
					{:else}
						<VideoTile
							stream={participantStreams.get(focusedParticipant.id) || null}
							name={focusedParticipant.name}
							size="lg"
							isAgent={!!focusedParticipant.isAgent}
							avatarUrl={focusedParticipant.avatarUrl || ''}
							agentState={getAgentStateForParticipant(focusedParticipant)}
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
		speakerMuted={media.speakerMuted}
		screenEnabled={media.screenEnabled}
		{chatOpen}
		{unreadChat}
		{roomId}
		showInvite={true}
		isAlone={!hasRemotes}
		mics={media.mics}
		cameras={media.cameras}
		speakers={media.speakers}
		selectedMic={media.selectedMic}
		selectedCamera={media.selectedCamera}
		selectedSpeaker={media.selectedSpeaker}
		{connectionQuality}
		activeAgents={activeAgentSlugs}
		{loadingAgents}
		onToggleAudio={() => media.toggleAudio()}
		onToggleVideo={() => media.toggleVideo()}
		onToggleSpeaker={() => media.toggleSpeaker()}
		onToggleScreen={handleToggleScreen}
		onToggleChat={() => (chatOpen = !chatOpen)}
		onLeave={handleLeave}
		onSwitchMic={(id) => media.switchMic(id)}
		onSwitchCamera={(id) => media.switchCamera(id)}
		onSwitchSpeaker={(id) => media.switchSpeaker(id)}
		onInviteOpenChange={() => {}}
		onAddAgent={handleAddAgent}
		onRemoveAgent={handleRemoveAgent}
	/>

	<ChatPanel
		open={chatOpen}
		messages={chatPanelMessages}
		myId={room.myId}
		agentParticipantIds={agentParticipantIds()}
		{agentTypingIds}
		agentNames={agentNames()}
		onSend={handleChatSend}
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
				class="h-16 w-24 sm:h-20 sm:w-32 flex-shrink-0 cursor-pointer transition-transform duration-150 hover:scale-[1.04]
					{recentlyJoinedAgents.has(p.id) ? 'animate-agent-entrance' : ''}"
			>
				<VideoTile
					stream={participantStreams.get(p.id) || null}
					name={p.name}
					size="md"
					isAgent={!!p.isAgent}
					avatarUrl={p.avatarUrl || ''}
					agentState={getAgentStateForParticipant(p)}
				/>
			</button>
		{/each}
	</div>
{/snippet}
