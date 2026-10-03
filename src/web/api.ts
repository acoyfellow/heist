import { z } from "zod";
import { type LevelNumber, type Progress, progress } from "../worker/levels";
import {
	type AttemptResult,
	attemptResult,
	type LeaderEntry,
	type LevelStat,
	leaderboard,
	levelStats,
	type SharedAttack,
	sharedAttack,
} from "../worker/rules";

const errorBody = z.object({ error: z.string() });

export type AttemptOutcome = { kind: "result"; result: AttemptResult } | { kind: "error"; message: string };

function failure(message: string): AttemptOutcome {
	return { kind: "error", message };
}

const responseBody = z.union([attemptResult, errorBody, z.null()]).catch(null);

type ResponseBody = z.infer<typeof responseBody>;

function outcomeFrom(status: number, body: ResponseBody): AttemptOutcome {
	const error = errorBody.safeParse(body);

	if (status === 429 && !error.success) return failure("Too many attempts. Wait one minute and try again.");

	if (status >= 400) return failure(error.data?.error ?? "The vault did not answer. Try again in a minute.");

	const result = attemptResult.safeParse(body);

	return result.success
		? { kind: "result", result: result.data }
		: failure("The vault sent an answer that the page cannot read. Try again.");
}

export async function sendAttempt(handle: string, attack: string, level: LevelNumber): Promise<AttemptOutcome> {
	try {
		const res = await fetch("/api/attempt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ handle, attack, level }),
		});

		return outcomeFrom(res.status, responseBody.parse(await res.json().catch(() => null)));
	} catch {
		return failure("The page cannot reach the vault. Check your connection and try again.");
	}
}

export async function loadBoard(): Promise<LeaderEntry[] | null> {
	try {
		const res = await fetch("/api/leaderboard");

		if (!res.ok) return null;

		return leaderboard.safeParse(await res.json()).data ?? null;
	} catch {
		return null;
	}
}

export async function loadStats(): Promise<LevelStat[]> {
	try {
		const res = await fetch("/api/stats");

		return res.ok ? (levelStats.safeParse(await res.json()).data ?? []) : [];
	} catch {
		return [];
	}
}

export async function loadShared(id: string): Promise<SharedAttack | null> {
	try {
		const res = await fetch(`/api/share/${encodeURIComponent(id)}`);

		return res.ok ? (sharedAttack.safeParse(await res.json()).data ?? null) : null;
	} catch {
		return null;
	}
}

const PROGRESS_KEY = "heist-progress";

export function readProgress(): Progress {
	try {
		return progress.parse(JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "null"));
	} catch {
		return progress.parse(null);
	}
}

export function saveProgress(state: Progress): void {
	localStorage.setItem(PROGRESS_KEY, JSON.stringify(state));
}

export function beep(frequency: number, ms: number): void {
	const audio = new AudioContext();
	const osc = audio.createOscillator();
	const gain = audio.createGain();
	osc.type = "square";
	osc.frequency.value = frequency;
	gain.gain.value = 0.05;
	osc.connect(gain).connect(audio.destination);
	osc.start();
	osc.stop(audio.currentTime + ms / 1000);
}
