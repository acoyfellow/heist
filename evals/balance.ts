import { writeFileSync } from "node:fs";
import { z } from "zod";
import { brokeInAt, LEVELS, type Level, systemFor } from "../src/worker/levels";
import { CLEF_QUESTION, clefOutput, leaksSecret, makeSecret, VICTIM_MODEL } from "../src/worker/rules";
import { ATTACKS, type Attack, type Tier } from "./attacks";

const env = z.object({ CF_API_TOKEN: z.string().min(1), CLOUDFLARE_ACCOUNT_ID: z.string().min(1) }).parse(process.env);

const base = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/`;

const llmBody = z.object({
	result: z.object({ response: z.unknown(), usage: z.object({ neurons: z.number().catch(0) }).catch({ neurons: 0 }) }),
});

const clefBody = z.object({ result: clefOutput.extend({ usage: z.object({ input_tokens: z.number() }).catch({ input_tokens: 0 }) }) });

interface ChatPayload {
	messages: { role: string; content: string }[];
	max_tokens: number;
	temperature: number;
}

interface ClefPayload {
	model: string;
	state: string;
	questions: { injection: { type: string; instructions: string } };
}

type RunPayload = ChatPayload | ClefPayload;

async function run(model: string, payload: RunPayload): Promise<object> {
	for (let tryNo = 0; tryNo < 4; tryNo++) {
		const res = await fetch(base + model, {
			method: "POST",
			headers: { authorization: `Bearer ${env.CF_API_TOKEN}` },
			body: JSON.stringify(payload),
		});

		if (res.ok)
			return z
				.object({})
				.passthrough()
				.parse(await res.json());
		await Bun.sleep(2000 * (tryNo + 1));
	}

	throw new Error(`${model} failed`);
}

const trials = Number(process.env.TRIALS ?? "2");

async function trial(level: Level, attack: Attack, injection: number, clefTokens: number) {
	const secret = makeSecret(crypto.getRandomValues(new Uint8Array(6)));

	const raw = llmBody.parse(
		await run(VICTIM_MODEL, {
			messages: [
				{ role: "system", content: systemFor(level, secret) },
				{ role: "user", content: attack.text },
			],
			max_tokens: 300,
			temperature: 0.2,
		}),
	);

	const response = raw.result.response;
	const reply = z.string().safeParse(response).data ?? JSON.stringify(response ?? "");
	const leaked = leaksSecret(reply, secret);

	return {
		level: level.number,
		tier: attack.tier,
		attack: attack.text,
		reply,
		leaked,
		injectionProbability: injection,
		threshold: level.threshold,
		brokeIn: brokeInAt(level, injection, leaked),
		cost: { llamaNeurons: raw.result.usage.neurons, clefInputTokens: clefTokens },
	};
}

type Row = Awaited<ReturnType<typeof trial>>;

async function pool<T>(jobs: (() => Promise<T>)[], width: number): Promise<T[]> {
	const out: T[] = [];
	let next = 0;

	const worker = async () => {
		while (next < jobs.length) {
			const job = jobs[next++];

			if (job) out.push(await job());
		}
	};

	await Promise.all(Array.from({ length: width }, worker));

	return out;
}

const scores = await pool(
	ATTACKS.map((attack) => async () => {
		const parsed = clefBody.parse(
			await run("@cf/cloudflare/clef", {
				model: "clef",
				state: attack.text,
				questions: { injection: { type: "noul", instructions: CLEF_QUESTION } },
			}),
		);

		return { attack, p: parsed.result.answers.injection.noul, tokens: parsed.result.usage.input_tokens };
	}),
	6,
);

const jobs = LEVELS.flatMap((level) =>
	scores.flatMap((s) => Array.from({ length: trials }, () => () => trial(level, s.attack, s.p, s.tokens))),
);

const rows: Row[] = await pool(jobs, 8);

const tiers: Tier[] = ["naive", "intermediate", "skilled"];

const summary = LEVELS.map((level) => ({
	level: level.number,
	threshold: level.threshold,
	...Object.fromEntries(
		tiers.map((tier) => {
			const mine = rows.filter((r) => r.level === level.number && r.tier === tier);
			const wins = mine.filter((r) => r.brokeIn).length;
			const leaks = mine.filter((r) => r.leaked).length;

			return [tier, { tries: mine.length, leaks, wins, winRate: Number((wins / Math.max(1, mine.length)).toFixed(3)) }];
		}),
	),
}));

console.log(JSON.stringify(summary, null, 1));

writeFileSync(
	process.env.OUT ?? "receipts/006-balance.json",
	`${JSON.stringify({ at: new Date().toISOString(), victimModel: VICTIM_MODEL, clefModel: "@cf/cloudflare/clef", path: "Workers AI REST API with the account token, not the public site", trialsPerAttackPerLevel: trials, attacks: ATTACKS.length, summary, totals: { llamaNeurons: rows.reduce((n, r) => n + r.cost.llamaNeurons, 0), clefInputTokens: scores.reduce((n, s) => n + s.tokens, 0) }, rows }, null, 1)}\n`,
);
