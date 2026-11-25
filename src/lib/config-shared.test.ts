import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const configSource = readFileSync(new URL("./config-shared.js", import.meta.url), "utf8");
const emojiSource = readFileSync(new URL("./xq-emoji-shared.js", import.meta.url), "utf8");

describe("shared page config", () => {
  it("is idempotent across reinjection while preserving the frozen global descriptor", () => {
    const context = runInNewContext("globalThis");
    runInNewContext(configSource, context);
    const firstConfig = (context as { XQ_DADAO_CONFIG: object }).XQ_DADAO_CONFIG;
    const firstDescriptor = runInNewContext('Object.getOwnPropertyDescriptor(globalThis, "XQ_DADAO_CONFIG")', context);

    expect(() => runInNewContext(configSource, context)).not.toThrow();

    const secondConfig = (context as { XQ_DADAO_CONFIG: object }).XQ_DADAO_CONFIG;
    const secondDescriptor = runInNewContext('Object.getOwnPropertyDescriptor(globalThis, "XQ_DADAO_CONFIG")', context);
    expect(secondConfig).toBe(firstConfig);
    expect(Object.isFrozen(secondConfig)).toBe(true);
    expect(secondDescriptor).toEqual(firstDescriptor);
    expect(secondDescriptor).toMatchObject({ writable: false, configurable: false, enumerable: false });
  });

  it("keeps the actual emoji source safe across reinjection", () => {
    const context = runInNewContext("globalThis");
    runInNewContext(emojiSource, context);
    const firstEmoji = (context as { XQ_EMOJI: object }).XQ_EMOJI;
    const firstDescriptor = runInNewContext('Object.getOwnPropertyDescriptor(globalThis, "XQ_EMOJI")', context);

    expect(() => runInNewContext(emojiSource, context)).not.toThrow();

    const secondEmoji = (context as { XQ_EMOJI: object }).XQ_EMOJI;
    const secondDescriptor = runInNewContext('Object.getOwnPropertyDescriptor(globalThis, "XQ_EMOJI")', context);
    expect(secondEmoji).toBe(firstEmoji);
    expect(Object.isFrozen(secondEmoji)).toBe(true);
    expect(secondDescriptor).toEqual(firstDescriptor);
    expect(secondDescriptor).toMatchObject({ writable: false, configurable: false });
  });
});
