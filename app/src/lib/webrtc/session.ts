const CF_API = 'https://rtc.live.cloudflare.com/v1';

interface SessionResponse {
	sessionId: string;
}

interface TracksResponse {
	requiresImmediateRenegotiation: boolean;
	sessionDescription?: { sdp: string; type: 'offer' | 'answer' };
	tracks?: Array<{ trackName: string; mid: string; errorCode?: string; errorDescription?: string }>;
}

export async function createSession(): Promise<string> {
	const res = await fetch('/api/session', { method: 'POST' });
	if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
	const data: SessionResponse = await res.json();
	return data.sessionId;
}

export async function pushLocalTracks(
	sessionId: string,
	sdpOffer: string,
	tracks: Array<{ trackName: string; mid: string }>
): Promise<TracksResponse> {
	const res = await fetch('/api/tracks', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			action: 'push',
			sessionId,
			sessionDescription: { sdp: sdpOffer, type: 'offer' },
			tracks: tracks.map((t) => ({
				location: 'local',
				mid: t.mid,
				trackName: t.trackName
			}))
		})
	});
	if (!res.ok) throw new Error(`Failed to push tracks: ${res.status}`);
	return res.json();
}

export async function pullRemoteTracks(
	sessionId: string,
	tracks: Array<{ sessionId: string; trackName: string; simulcast?: SimulcastPrefs }>
): Promise<TracksResponse> {
	const res = await fetch('/api/tracks', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			action: 'pull',
			sessionId,
			tracks: tracks.map((t) => ({
				location: 'remote',
				sessionId: t.sessionId,
				trackName: t.trackName,
				...(t.simulcast ? { simulcast: t.simulcast } : {})
			}))
		})
	});
	if (!res.ok) throw new Error(`Failed to pull tracks: ${res.status}`);
	return res.json();
}

export interface SimulcastPrefs {
	preferredRid: string;
	priorityOrdering?: 'none' | 'asciibetical';
	ridNotAvailable?: 'none' | 'asciibetical';
}

export async function updateTrackSimulcast(
	sessionId: string,
	tracks: Array<{ mid: string; sessionId: string; trackName: string; simulcast: SimulcastPrefs }>
): Promise<void> {
	const res = await fetch('/api/tracks-update', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			sessionId,
			tracks: tracks.map((t) => ({
				location: 'remote',
				mid: t.mid,
				sessionId: t.sessionId,
				trackName: t.trackName,
				simulcast: t.simulcast
			}))
		})
	});
	if (!res.ok) {
		console.warn('[WebRTC] updateTrackSimulcast failed:', res.status);
	}
}

export async function renegotiate(sessionId: string, sdpAnswer: string): Promise<void> {
	const res = await fetch('/api/renegotiate', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			sessionId,
			sessionDescription: { sdp: sdpAnswer, type: 'answer' }
		})
	});
	if (!res.ok) throw new Error(`Failed to renegotiate: ${res.status}`);
}

export async function closeTracks(
	sessionId: string,
	mids: string[],
	force = false
): Promise<void> {
	const res = await fetch('/api/tracks-close', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			sessionId,
			tracks: mids.map((mid) => ({ mid })),
			force
		})
	});
	if (!res.ok) throw new Error(`Failed to close tracks: ${res.status}`);
}

export async function fetchIceServers(): Promise<RTCIceServer[]> {
	try {
		const res = await fetch('/api/turn', { method: 'POST' });
		if (!res.ok) throw new Error(`TURN API error: ${res.status}`);
		const data = await res.json();
		if (data.iceServers?.length) {
			console.log('[WebRTC] Using TURN credentials:', data.iceServers.length, 'servers');
			return data.iceServers;
		}
	} catch (e) {
		console.warn('[WebRTC] TURN credential fetch failed, falling back to STUN:', e);
	}
	return [{ urls: 'stun:stun.cloudflare.com:3478' }];
}

export async function createPeerConnection(): Promise<RTCPeerConnection> {
	const iceServers = await fetchIceServers();
	return new RTCPeerConnection({
		iceServers,
		bundlePolicy: 'max-bundle'
	});
}

export function enableOpusDtxInSdp(sdp: string): string {
	return sdp.replace(
		/(a=fmtp:\d+ .*opus.*)/gi,
		(match) => match.includes('usedtx=1') ? match : `${match};usedtx=1`
	);
}

export function getConnectionQuality(pc: RTCPeerConnection): Promise<'good' | 'fair' | 'poor' | 'unknown'> {
	return pc.getStats().then(stats => {
		let rtt = -1;
		let packetsLost = 0;
		let packetsReceived = 0;

		stats.forEach(report => {
			if (report.type === 'candidate-pair' && report.state === 'succeeded') {
				if (report.currentRoundTripTime !== undefined) {
					rtt = report.currentRoundTripTime * 1000;
				}
			}
			if (report.type === 'inbound-rtp' && report.kind === 'video') {
				packetsLost += report.packetsLost ?? 0;
				packetsReceived += report.packetsReceived ?? 0;
			}
		});

		if (rtt < 0) return 'unknown';

		const totalPackets = packetsReceived + packetsLost;
		const lossRate = totalPackets > 0 ? packetsLost / totalPackets : 0;

		if (rtt < 150 && lossRate < 0.02) return 'good';
		if (rtt < 400 && lossRate < 0.08) return 'fair';
		return 'poor';
	}).catch(() => 'unknown' as const);
}
