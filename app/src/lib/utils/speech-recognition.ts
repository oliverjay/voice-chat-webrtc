import { browser } from '$app/environment';

/** Web Speech API (Chromium / Safari); names vary by browser. */
type SpeechRecognitionInstance = {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	maxAlternatives: number;
	start: () => void;
	stop: () => void;
	abort: () => void;
	onresult: ((event: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null;
	onerror: ((event: { error: string }) => void) | null;
	onend: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
	if (!browser || typeof window === 'undefined') return null;
	const w = window as unknown as {
		SpeechRecognition?: SpeechRecognitionCtor;
		webkitSpeechRecognition?: SpeechRecognitionCtor;
	};
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isBrowserSpeechRecognitionSupported(): boolean {
	return getRecognitionCtor() !== null;
}

export type ListenOnceHandlers = {
	/** Latest interim (non-final) phrase */
	onInterim?: (text: string) => void;
	/** Called once when recognition stops with full final text (may be empty) */
	onFinal: (text: string) => void;
	/** Recognition error code (e.g. not-allowed, no-speech) */
	onError?: (code: string) => void;
	/** Session aborted (e.g. new listen started elsewhere) — do not treat as empty transcript */
	onCancelled?: () => void;
};

let activeAbort: (() => void) | null = null;

export function stopActiveSpeechRecognition(): void {
	activeAbort?.();
	activeAbort = null;
}

/**
 * One utterance (continuous=false), then stop. Must be started from a user gesture.
 * Returns abort function. Starting a new session aborts any previous one.
 */
export function startListenOnce(
	lang: string,
	handlers: ListenOnceHandlers
): () => void {
	const Ctor = getRecognitionCtor();
	if (!Ctor) {
		handlers.onError?.('unsupported');
		handlers.onFinal('');
		return () => {};
	}

	stopActiveSpeechRecognition();

	const rec = new Ctor();
	rec.lang = lang;
	rec.continuous = false;
	rec.interimResults = true;
	rec.maxAlternatives = 1;

	let accumulated = '';
	/** Full hypothesis from all result slots (some engines only finalize after silence; onend can run with empty finals). */
	let lastFullTranscript = '';
	let cancelled = false;

	rec.onresult = (event) => {
		for (let i = event.resultIndex; i < event.results.length; i++) {
			const r = event.results[i];
			if (r.isFinal) {
				accumulated += r[0].transcript;
			}
		}
		lastFullTranscript = '';
		for (let i = 0; i < event.results.length; i++) {
			lastFullTranscript += event.results[i][0].transcript;
		}
		handlers.onInterim?.(lastFullTranscript);
	};

	rec.onerror = (event: { error: string }) => {
		if (event.error === 'aborted') {
			cancelled = true;
			return;
		}
		handlers.onError?.(event.error);
	};

	rec.onend = () => {
		activeAbort = null;
		if (cancelled) {
			handlers.onCancelled?.();
			return;
		}
		const fromFinals = accumulated.trim();
		const fallback = lastFullTranscript.trim();
		handlers.onFinal(fromFinals || fallback);
	};

	const abort = () => {
		cancelled = true;
		try {
			rec.abort();
		} catch {
			try {
				rec.stop();
			} catch {}
		}
	};

	activeAbort = abort;

	try {
		rec.start();
	} catch (e) {
		activeAbort = null;
		console.warn('[SpeechRecognition] start failed:', e);
		handlers.onError?.('start-failed');
		handlers.onFinal('');
	}

	return abort;
}

export type ContinuousDictationHandlers = {
	onInterim?: (text: string) => void;
	/** One browser final segment (phrase); may fire many times until stopped. */
	onFinalSegment?: (text: string) => void;
	onError?: (code: string) => void;
};

/**
 * Continuous dictation until `stopActiveSpeechRecognition()` — appends phrase finals; restarts after silence.
 * Use instead of startListenOnce when the user should not tap the mic for every sentence.
 */
export function startContinuousDictation(
	lang: string,
	handlers: ContinuousDictationHandlers
): () => void {
	const Ctor = getRecognitionCtor();
	if (!Ctor) {
		handlers.onError?.('unsupported');
		return () => {};
	}

	stopActiveSpeechRecognition();

	const rec = new Ctor();
	rec.lang = lang;
	rec.continuous = true;
	rec.interimResults = true;
	rec.maxAlternatives = 1;

	let cancelled = false;
	let shouldRun = true;

	const stop = () => {
		shouldRun = false;
		cancelled = true;
		try {
			rec.abort();
		} catch {
			try {
				rec.stop();
			} catch {}
		}
	};

	rec.onresult = (event) => {
		for (let i = event.resultIndex; i < event.results.length; i++) {
			const r = event.results[i];
			if (r.isFinal) {
				const t = r[0].transcript.trim();
				if (t) handlers.onFinalSegment?.(t);
			}
		}
		let interim = '';
		for (let i = 0; i < event.results.length; i++) {
			if (!event.results[i].isFinal) {
				interim += event.results[i][0].transcript;
			}
		}
		handlers.onInterim?.(interim);
	};

	rec.onerror = (event: { error: string }) => {
		if (event.error === 'aborted') return;
		handlers.onError?.(event.error);
	};

	rec.onend = () => {
		if (cancelled || !shouldRun) {
			activeAbort = null;
			return;
		}
		try {
			rec.start();
		} catch {
			activeAbort = null;
			handlers.onError?.('restart-failed');
		}
	};

	activeAbort = stop;

	try {
		rec.start();
	} catch (e) {
		activeAbort = null;
		console.warn('[SpeechRecognition] continuous start failed:', e);
		handlers.onError?.('start-failed');
	}

	return stop;
}
