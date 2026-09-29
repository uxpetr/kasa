// The language model behind Kasa Bot (P-17, D-198). Real answers go through the Vercel AI
// Gateway; development and tests use a stub, so building and testing costs nothing.
import { generateText, type LanguageModel } from "ai";

export interface BotReply {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface BotModel {
  /** A model id with a known price, or "stub". */
  id: string;
  answer(input: { instructions: string; prompt: string }): Promise<BotReply>;
}

/** List prices in US dollars per million tokens, for the spending cap. */
export const PRICES: Record<string, { input: number; output: number }> = {
  "anthropic/claude-haiku-4.5": { input: 1, output: 5 },
  stub: { input: 0, output: 0 },
};

export const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
export const MAX_ANSWER_TOKENS = 600;
export const ANSWER_TIMEOUT_MS = 30_000;

/** What an answer cost, in millionths of a dollar, rounded up. */
export function costMicros(reply: Pick<BotReply, "model" | "inputTokens" | "outputTokens">): number {
  const price = PRICES[reply.model];
  if (!price) throw new Error(`No price for model ${reply.model}`);
  return Math.ceil(reply.inputTokens * price.input + reply.outputTokens * price.output);
}

/** A model through the AI SDK: the AI Gateway (AI_GATEWAY_API_KEY) for an id string, or any LanguageModel in tests. */
export function sdkModel(id: string, model: LanguageModel = id): BotModel {
  if (!PRICES[id]) throw new Error(`No price for model ${id}; add it to PRICES`);
  return {
    id,
    async answer({ instructions, prompt }) {
      const result = await generateText({ model, instructions, prompt, maxOutputTokens: MAX_ANSWER_TOKENS, timeout: ANSWER_TIMEOUT_MS, maxRetries: 1 });
      return { text: result.text.trim(), model: id, inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 };
    },
  };
}

/**
 * Answers without a model: says how much of the pile it was given, so tests and local runs can see
 * the wiring. `delayMs` stands in for the model's time, so the thinking state shows locally (D-199).
 */
export function createStubModel(delayMs = 0): BotModel {
  return {
    id: "stub",
    async answer({ prompt }) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const entries = prompt.split("\n").filter((line) => line.startsWith("#")).length;
      return { text: `(Stub answer, no model.) I read ${entries} entries in this pile.`, model: "stub", inputTokens: 0, outputTokens: 0 };
    },
  };
}
export const stubModel = createStubModel();
export const STUB_DELAY_MS = 1500;

/**
 * KASA_BOT_MODEL picks the model: "stub" for local development and CI, otherwise a priced
 * gateway id (default Claude Haiku 4.5), which needs AI_GATEWAY_API_KEY. Without a key the
 * bot is off: answers fail with a card saying so, rather than a stub answer reaching real people.
 */
export function botModelFromEnv(env: NodeJS.ProcessEnv): BotModel | null {
  const id = env.KASA_BOT_MODEL || DEFAULT_MODEL;
  if (id === "stub") return createStubModel(env.KASA_BOT_STUB_DELAY_MS ? Number(env.KASA_BOT_STUB_DELAY_MS) : STUB_DELAY_MS);
  if (!env.AI_GATEWAY_API_KEY) return null;
  return sdkModel(id);
}
