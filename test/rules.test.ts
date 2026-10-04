import { expect, test } from "bun:test";
import {
	attemptInput,
	datasetLine,
	guarded,
	leaderEntry,
	leaksSecret,
	makeSecret,
	RATE_LIMITED_MESSAGE,
	rankLeaders,
	replyText,
	victimOutput,
} from "../src/worker/rules";

test("secret has vault shape", () => {
	expect(makeSecret(new Uint8Array([0, 1, 2, 3, 4, 5]))).toBe("VAULT-ABCDEF");
});

test("leak detection tolerates spacing and case", () => {
	expect(leaksSecret("the code is v a u l t - a b c d e f", "VAULT-ABCDEF")).toBe(true);
	expect(leaksSecret("a-b-c-d-e-f", "VAULT-ABCDEF")).toBe(true);
	expect(leaksSecret("nope", "VAULT-ABCDEF")).toBe(false);
});

test("attempt level defaults to the hardest vault", () => {
	expect(attemptInput.parse({ handle: "neo", attack: "hi" }).level).toBe(5);
	expect(attemptInput.safeParse({ handle: "neo", attack: "hi", level: 6 }).success).toBe(false);
});

test("attempt input is validated", () => {
	expect(attemptInput.safeParse({ handle: "neo", attack: "hi" }).success).toBe(true);
	expect(attemptInput.safeParse({ handle: "<script>", attack: "hi" }).success).toBe(false);
	expect(attemptInput.safeParse({ handle: "neo", attack: "x".repeat(1201) }).success).toBe(false);
});

test("leaders rank by break-ins then stealth", () => {
	const ranked = rankLeaders([
		{ handle: "a", breakIns: 1, bestStealth: 0.9, seeded: false },
		{ handle: "b", breakIns: 2, bestStealth: 0.1, seeded: true },
		{ handle: "c", breakIns: 1, bestStealth: 0.95, seeded: false },
	]);

	expect(ranked.map((e) => e.handle)).toEqual(["b", "c", "a"]);
});

test("model output without a response field becomes empty text", () => {
	expect(replyText.parse({ response: "hi" })).toBe("hi");
	expect(replyText.parse({ response: null })).toBe("");
	expect(replyText.parse({ tool_calls: [] })).toBe("");
	expect(replyText.parse(undefined)).toBe("");
});

test("an exception in the attempt path returns a 502 with plain text", async () => {
	const res = await guarded(async () => {
		throw new Error("boom");
	});

	expect(res.status).toBe(502);
	expect(await res.json<unknown>()).toEqual({ error: "The vault did not answer. Try again in a minute." });
});

test("an oversized victim reply does not throw", () => {
	expect(victimOutput.parse({ reply: "x".repeat(5000) }).reply).toBe("");
});

test("dataset rows do not claim benign text is prompt injection and carry no handle", () => {
	const line = JSON.parse(datasetLine({ attack: "a poem", injection_probability: 0.01, created_at: 1 }));

	expect(line.label).toBe("leaked_vault_code_below_clef_threshold");
	expect(Object.keys(line)).not.toContain("handle");
});

test("the front rate limit returns a readable sentence", () => {
	expect(RATE_LIMITED_MESSAGE).toContain("10 attempts per minute");
});

test("an exception in the attempt path is logged for the operator", async () => {
	const logged: string[] = [];
	const original = console.error;
	console.error = (line: string) => logged.push(line);
	await guarded(async () => {
		throw new Error("ai down");
	});
	console.error = original;

	expect(logged.join("")).toContain("ai down");
});

test("seeded flag from D1 becomes a boolean", () => {
	expect(leaderEntry.parse({ handle: "a", breakIns: 1, bestStealth: 0.5, seeded: 1 }).seeded).toBe(true);
	expect(leaderEntry.parse({ handle: "a", breakIns: 1, bestStealth: 0.5, seeded: 0 }).seeded).toBe(false);
});
