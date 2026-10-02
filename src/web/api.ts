import { z } from "zod";
import { type AttemptResult, attemptResult, type LeaderEntry, leaderboard } from "../worker/rules";

const errorBody = z.object({ error: z.string() });

export async function sendAttempt(handle: string, attack: string): Promise<AttemptResult | string> {
	const res = await fetch("/api/attempt", {
		method: "POST",
		body: JSON.stringify({ handle, attack }),
	});
	const body: unknown = await res.json();
	if (!res.ok) return errorBody.safeParse(body).data?.error ?? "request failed";
	return attemptResult.parse(body);
}

export async function loadBoard(): Promise<LeaderEntry[]> {
	return leaderboard.parse(await (await fetch("/api/leaderboard")).json());
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
