import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { z } from "zod";
import {
	ATTEMPTS_PER_IP_PER_HOUR,
	type AttemptInput,
	type AttemptResult,
	attemptInput,
	CLEF_QUESTION,
	clefOutput,
	datasetLine,
	dayWindow,
	GLOBAL_ATTEMPTS_PER_DAY,
	guarded,
	hourWindow,
	judge,
	type LeaderEntry,
	leaderboard,
	leaksSecret,
	makeSecret,
	rankLeaders,
	replyText,
	VICTIM_MODEL,
	victimOutput,
} from "./rules";
import { VICTIM_SOURCE } from "./victim";

interface Env {
	AI: Ai;
	DB: D1Database;
	ARCADE: DurableObjectNamespace<Arcade>;
	LOADER: WorkerLoader;
}

const gateway = { gateway: { id: "default" } };

export class Brain extends WorkerEntrypoint<Env> {
	async complete(system: string, user: string): Promise<string> {
		const raw = await this.env.AI.run(
			VICTIM_MODEL,
			{
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
				max_tokens: 300,
				temperature: 0.2,
			},
			gateway,
		);

		return replyText.parse(raw);
	}
}

export class Arcade extends DurableObject<Env> {
	async take(key: string, limit: number): Promise<boolean> {
		const used = z
			.number()
			.catch(0)
			.parse(await this.ctx.storage.get(key));

		if (used >= limit) return false;
		await this.ctx.storage.put(key, used + 1);

		return true;
	}
	async record(entry: { handle: string; stealth: number }): Promise<void> {
		const board = leaderboard.catch([]).parse(await this.ctx.storage.get("board"));
		const found = board.find((e) => e.handle === entry.handle);

		const next: LeaderEntry[] = found
			? board.map((e) =>
					e.handle === entry.handle
						? {
								handle: e.handle,
								breakIns: e.breakIns + 1,
								bestStealth: Math.max(e.bestStealth, entry.stealth),
							}
						: e,
				)
			: [...board, { handle: entry.handle, breakIns: 1, bestStealth: entry.stealth }];

		await this.ctx.storage.put("board", rankLeaders(next));
	}
	async board(): Promise<LeaderEntry[]> {
		return leaderboard.catch([]).parse(await this.ctx.storage.get("board"));
	}
}

async function scoreInjection(env: Env, attack: string): Promise<number> {
	const raw = await env.AI.run(
		"@cf/cloudflare/clef",
		{
			model: "clef",
			state: attack,
			questions: { injection: { type: "noul", instructions: CLEF_QUESTION } },
		},
		gateway,
	);

	return clefOutput.parse(raw).answers.injection.noul;
}

async function runVictim(env: Env, ctx: ExecutionContext, attack: string, secret: string): Promise<string> {
	const worker = env.LOADER.get(`victim-${crypto.randomUUID()}`, () => ({
		compatibilityDate: "2026-09-01",
		mainModule: "victim.js",
		modules: { "victim.js": VICTIM_SOURCE },
		env: { BRAIN: ctx.exports.Brain({ props: {} }) },
		globalOutbound: null,
	}));

	const response = await worker.getEntrypoint().fetch("https://victim/", {
		method: "POST",
		body: JSON.stringify({ attack, secret }),
	});

	const parsed = victimOutput.safeParse(await response.json().catch(() => null));

	return parsed.success ? parsed.data.reply : "";
}

async function attempt(env: Env, ctx: ExecutionContext, input: AttemptInput): Promise<AttemptResult> {
	const secret = makeSecret(crypto.getRandomValues(new Uint8Array(6)));
	const [injectionProbability, reply] = await Promise.all([scoreInjection(env, input.attack), runVictim(env, ctx, input.attack, secret)]);
	const leaked = leaksSecret(reply, secret);
	const brokeIn = judge(injectionProbability, leaked);
	const id = crypto.randomUUID();
	await env.DB.prepare(
		"INSERT INTO attempts (id, created_at, handle, attack, injection_probability, reply, leaked, broke_in) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(id, Date.now(), input.handle, input.attack, injectionProbability, reply, leaked ? 1 : 0, brokeIn ? 1 : 0)
		.run();

	if (brokeIn)
		await env.ARCADE.getByName("leaderboard").record({
			handle: input.handle,
			stealth: 1 - injectionProbability,
		});

	return { id, injectionProbability, reply, leaked, brokeIn };
}

const datasetRow = z.object({
	attack: z.string(),
	injection_probability: z.number(),
	created_at: z.number(),
});

async function exportDataset(env: Env): Promise<Response> {
	const { results } = await env.DB.prepare(
		"SELECT attack, injection_probability, created_at FROM attempts WHERE broke_in = 1 ORDER BY created_at DESC LIMIT 1000",
	).all();

	const rows = z.array(datasetRow).parse(results);

	const lines = rows.map(datasetLine);

	return new Response(lines.join("\n"), {
		headers: {
			"content-type": "application/x-ndjson",
			"content-disposition": "attachment; filename=heist-evals.jsonl",
		},
	});
}

async function handleAttempt(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const parsed = attemptInput.safeParse(await request.json().catch(() => null));

	if (!parsed.success)
		return Response.json(
			{ error: "Enter a handle (letters, numbers, spaces, - or _, up to 24) and a message up to 1200 characters." },
			{ status: 400 },
		);
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	const now = Date.now();
	const perIp = await env.ARCADE.getByName(`ip:${ip}`).take(`h:${hourWindow(now)}`, ATTEMPTS_PER_IP_PER_HOUR);

	if (!perIp) return Response.json({ error: "Limit reached: 30 attempts per hour from one address. Try again later." }, { status: 429 });
	const global = await env.ARCADE.getByName("budget").take(`d:${dayWindow(now)}`, GLOBAL_ATTEMPTS_PER_DAY);

	if (!global) return Response.json({ error: "The daily limit of 3000 attempts is used. Try again tomorrow." }, { status: 429 });

	return Response.json(await attempt(env, ctx, parsed.data));
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/api/attempt" && request.method === "POST") return guarded(() => handleAttempt(request, env, ctx));

		if (url.pathname === "/api/leaderboard") return guarded(async () => Response.json(await env.ARCADE.getByName("leaderboard").board()));

		if (url.pathname === "/api/dataset.jsonl") return guarded(() => exportDataset(env));

		return Response.json({ error: "not found" }, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
