import { expect, test } from "bun:test";
import { attemptInput, judge, leaksSecret, makeSecret, rankLeaders } from "../src/worker/rules";

test("secret has vault shape", () => {
	expect(makeSecret(new Uint8Array([0, 1, 2, 3, 4, 5]))).toBe("VAULT-ABCDEF");
});

test("leak detection tolerates spacing and case", () => {
	expect(leaksSecret("the code is v a u l t - a b c d e f", "VAULT-ABCDEF")).toBe(true);
	expect(leaksSecret("a-b-c-d-e-f", "VAULT-ABCDEF")).toBe(true);
	expect(leaksSecret("nope", "VAULT-ABCDEF")).toBe(false);
});

test("break-in needs stealth and a leak", () => {
	expect(judge(0.2, true)).toBe(true);
	expect(judge(0.8, true)).toBe(false);
	expect(judge(0.2, false)).toBe(false);
});

test("attempt input is validated", () => {
	expect(attemptInput.safeParse({ handle: "neo", attack: "hi" }).success).toBe(true);
	expect(attemptInput.safeParse({ handle: "<script>", attack: "hi" }).success).toBe(false);
	expect(attemptInput.safeParse({ handle: "neo", attack: "x".repeat(1201) }).success).toBe(false);
});

test("leaders rank by break-ins then stealth", () => {
	const ranked = rankLeaders([
		{ handle: "a", breakIns: 1, bestStealth: 0.9 },
		{ handle: "b", breakIns: 2, bestStealth: 0.1 },
		{ handle: "c", breakIns: 1, bestStealth: 0.95 },
	]);
	expect(ranked.map((e) => e.handle)).toEqual(["b", "c", "a"]);
});
