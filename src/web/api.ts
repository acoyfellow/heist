import { z } from "zod";
import { type AttemptResult, attemptResult, type LeaderEntry, leaderboard } from "../worker/rules";

const errorBody = z.object({ error: z.string() });

export async function sendAttempt(handle: string, attack: string): Promise<AttemptResult | string> {
	try {
		const res = await fetch("/api/attempt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ handle, attack }),
		});
		const body: unknown = await res.json().catch(() => null);
		if (res.status === 429 && !errorBody.safeParse(body).success) return "Too many attempts. Wait one minute and try again.";
		if (!res.ok) return errorBody.safeParse(body).data?.error ?? "The vault did not answer. Try again in a minute.";
		return attemptResult.safeParse(body).data ?? "The vault sent an answer that the page cannot read. Try again.";
	} catch {
		return "The page cannot reach the vault. Check your connection and try again.";
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
