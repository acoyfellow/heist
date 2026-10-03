import { expect, test } from "bun:test";
import { brokeInAt, clear, hintFor, LEVELS, levelFor, openUpTo, progress, systemFor } from "../src/worker/levels";
import { winRate } from "../src/worker/rules";

test("there are five levels numbered in order", () => {
	expect(LEVELS.map((l) => l.number)).toEqual([1, 2, 3, 4, 5]);
});

test("each level states its rule in one sentence", () => {
	for (const level of LEVELS) {
		expect(level.rule.endsWith(".")).toBe(true);
		expect(level.rule.slice(0, -1)).not.toContain(".");
	}
});

test("each rule names its own Clef threshold", () => {
	for (const level of LEVELS) expect(level.rule).toContain(`${Math.round(level.threshold * 100)}%`);
});

test("thresholds never loosen as levels rise", () => {
	const thresholds = LEVELS.map((l) => l.threshold);

	expect([...thresholds].sort((a, b) => b - a)).toEqual(thresholds);
});

test("a break-in needs a leak and a score strictly below the level threshold", () => {
	const level = levelFor(5);

	expect(brokeInAt(level, level.threshold - 0.01, true)).toBe(true);
	expect(brokeInAt(level, level.threshold, true)).toBe(false);
	expect(brokeInAt(level, 0, false)).toBe(false);
	expect(brokeInAt(levelFor(1), 0.85, true)).toBe(true);
	expect(brokeInAt(levelFor(5), 0.85, true)).toBe(false);
});

test("the system prompt carries the secret", () => {
	expect(systemFor(levelFor(3), "VAULT-ABCDEF")).toContain("VAULT-ABCDEF");
});

test("hints never contain the secret and react to the outcome", () => {
	const level = levelFor(2);

	expect(hintFor(level, 0.99, true, 0)).toContain("Clef caught you");
	expect(hintFor(level, 0.99, false, 0)).toContain("Clef flagged you");
	expect(level.hints).toContain(hintFor(level, 0.1, false, 3));
	expect(hintFor(level, 0.1, false, 0)).not.toContain("VAULT-");
});

test("progress opens the next level and survives bad storage", () => {
	expect(openUpTo(progress.parse(null))).toBe(1);
	expect(openUpTo(progress.parse({ cleared: "x" }))).toBe(1);
	const after = clear(clear(progress.parse(null), 1), 2);

	expect(openUpTo(after)).toBe(3);
	expect(openUpTo(clear(after, 5))).toBe(5);
	expect(clear(after, 1)).toBe(after);
});

test("win rate reads as a sentence", () => {
	expect(winRate({ level: 1, attempts: 0, breakIns: 0 })).toBe("no attempts yet");
	expect(winRate({ level: 1, attempts: 20, breakIns: 1 })).toBe("1 of 20 (5.0%)");
});
