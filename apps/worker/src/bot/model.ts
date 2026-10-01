// The language model behind Kasa Bot (P-17, D-198). Real answers go through the Vercel AI
// Gateway; development and tests use a stub, so building and testing costs nothing.
import { gateway, generateText, jsonSchema, Output, type LanguageModel, type ToolSet } from "ai";

export interface BotReply {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** A recommendation from the web (P-20, D-204), before the worker checks it. */
export interface IdeaDraft {
  url: string;
  title: string;
  note: string;
  category: string | null;
}

export interface AnswerReply extends BotReply {
  ideas: IdeaDraft[];
  /** Web searches run, each billed at SEARCH_COST_MICROS. */
  searches: number;
  /** Every page URL the searches returned; an idea must be one of them. */
  foundUrls: string[];
}

export interface AnswerInput {
  instructions: string;
  prompt: string;
  /** For the stub, which can't read the prompt: whether the question asks for suggestions, and what to avoid. */
  wantsIdeas?: boolean;
  exclude?: string[];
}

/** What the model decided when sorting (P-19): new category names, and each entry's categories by ref. */
export interface SortDecision {
  newCategories: string[];
  assignments: { ref: number; categories: string[] }[];
}

export interface SortReply extends Omit<BotReply, "text"> {
  decision: SortDecision;
}

export interface SortInput {
  instructions: string;
  prompt: string;
  /** For the stub, which can't read the prompt: what's being sorted and what exists. */
  items: { ref: number; kind: string }[];
  categories: string[];
}

export interface BotModel {
  /** A model id with a known price, or "stub". */
  id: string;
  answer(input: AnswerInput): Promise<AnswerReply>;
  sort(input: SortInput): Promise<SortReply>;
}

const SORT_SCHEMA = jsonSchema<SortDecision>({
  type: "object",
  properties: {
    newCategories: { type: "array", items: { type: "string" } },
    assignments: {
      type: "array",
      items: {
        type: "object",
        properties: { ref: { type: "integer" }, categories: { type: "array", items: { type: "string" } } },
        required: ["ref", "categories"],
        additionalProperties: false,
      },
    },
  },
  required: ["newCategories", "assignments"],
  additionalProperties: false,
});
export const MAX_SORT_TOKENS = 1500;

const ANSWER_SCHEMA = jsonSchema<{ text: string; ideas: IdeaDraft[] }>({
  type: "object",
  properties: {
    text: { type: "string" },
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          note: { type: "string" },
          category: { type: ["string", "null"] },
        },
        required: ["url", "title", "note", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["text", "ideas"],
  additionalProperties: false,
});

/** Web searches per answer (D-204), and what each costs: Perplexity through the AI Gateway, $5 per 1,000. */
export const MAX_SEARCHES = 2;
export const SEARCH_COST_MICROS = 5000;
const SEARCH_TOOL = "web_search";

/** List prices in US dollars per million tokens, for the spending cap. */
export const PRICES: Record<string, { input: number; output: number }> = {
  "anthropic/claude-haiku-4.5": { input: 1, output: 5 },
  stub: { input: 0, output: 0 },
};

export const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
export const MAX_ANSWER_TOKENS = 1000;
export const ANSWER_TIMEOUT_MS = 30_000;

/** What an answer cost, in millionths of a dollar, rounded up, web searches included. */
export function costMicros(reply: Pick<BotReply, "model" | "inputTokens" | "outputTokens"> & { searches?: number }): number {
  const price = PRICES[reply.model];
  if (!price) throw new Error(`No price for model ${reply.model}`);
  return Math.ceil(reply.inputTokens * price.input + reply.outputTokens * price.output) + (reply.searches ?? 0) * SEARCH_COST_MICROS;
}

/** Search queries in one tool call; one call may carry several, and each is billed. */
function queriesIn(input: unknown): number {
  const query = (input as { query?: unknown } | null)?.query;
  return Array.isArray(query) ? query.length : query ? 1 : 0;
}

/** Page URLs in a search tool's result. */
function urlsIn(output: unknown): string[] {
  const results = (output as { results?: unknown } | null)?.results;
  return Array.isArray(results) ? results.map((r) => (r as { url?: unknown })?.url).filter((u): u is string => typeof u === "string") : [];
}

type Step = { toolCalls: { toolName: string; input: unknown }[]; toolResults: { toolName: string; output: unknown }[] };
function searchesIn(steps: Step[]): number {
  return steps.flatMap((s) => s.toolCalls).filter((c) => c.toolName === SEARCH_TOOL).reduce((n, c) => n + queriesIn(c.input), 0);
}

/** A model through the AI SDK: the AI Gateway (AI_GATEWAY_API_KEY) for an id string, or any LanguageModel in tests. */
export function sdkModel(id: string, model: LanguageModel = id, tools: ToolSet = { [SEARCH_TOOL]: gateway.tools.perplexitySearch({ maxResults: 8, maxTokensPerPage: 512 }) }): BotModel {
  if (!PRICES[id]) throw new Error(`No price for model ${id}; add it to PRICES`);
  return {
    id,
    async answer({ instructions, prompt }) {
      const result = await generateText({
        model,
        instructions,
        prompt,
        tools,
        output: Output.object({ schema: ANSWER_SCHEMA }),
        // Up to MAX_SEARCHES searches, then the answer; after that the search tool is put away.
        stopWhen: ({ steps }) => steps.length >= MAX_SEARCHES + 2,
        prepareStep: ({ steps }) => (searchesIn(steps) >= MAX_SEARCHES ? { activeTools: [] } : {}),
        maxOutputTokens: MAX_ANSWER_TOKENS,
        timeout: ANSWER_TIMEOUT_MS * 2,
        maxRetries: 1,
      });
      const steps = result.steps as unknown as Step[];
      return {
        text: (result.output?.text ?? "").trim(),
        ideas: Array.isArray(result.output?.ideas) ? result.output.ideas : [],
        searches: searchesIn(steps),
        foundUrls: steps.flatMap((s) => s.toolResults).filter((r) => r.toolName === SEARCH_TOOL).flatMap((r) => urlsIn(r.output)),
        model: id,
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
      };
    },
    async sort({ instructions, prompt }) {
      const result = await generateText({
        model,
        instructions,
        prompt,
        output: Output.object({ schema: SORT_SCHEMA }),
        maxOutputTokens: MAX_SORT_TOKENS,
        timeout: ANSWER_TIMEOUT_MS,
        maxRetries: 1,
      });
      return { decision: result.output, model: id, inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 };
    },
  };
}

/** The stub's categories: one per kind, so local runs and tests can see sorting work. */
export const STUB_CATEGORIES: Record<string, string> = { link: "Links", photo: "Photos", note: "Notes" };

/**
 * Answers without a model: says how much of the pile it was given, so tests and local runs can see
 * the wiring. `delayMs` stands in for the model's time, so the thinking state shows locally (D-199).
 */
export function createStubModel(delayMs = 0): BotModel {
  return {
    id: "stub",
    async answer({ prompt, wantsIdeas, exclude = [] }) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const entries = prompt.split("\n").filter((line) => line.startsWith("#")).length;
      const text = `(Stub answer, no model.) I read ${entries} entries in this pile.`;
      if (!wantsIdeas) return { text, ideas: [], searches: 0, foundUrls: [], model: "stub", inputTokens: 0, outputTokens: 0 };
      // Fake places on example.com, never fetched, so "Add to pile" can be tried offline.
      const ideas = STUB_IDEAS.filter((i) => !exclude.includes(i.url)).slice(0, 3);
      return { text: `${text} Here are some ideas.`, ideas, searches: 1, foundUrls: ideas.map((i) => i.url), model: "stub", inputTokens: 0, outputTokens: 0 };
    },
    async sort({ items, categories }) {
      const known = new Set(categories.map((c) => c.toLowerCase()));
      const wanted = items.map((i) => ({ ref: i.ref, name: STUB_CATEGORIES[i.kind] ?? "Other" }));
      const newCategories = [...new Set(wanted.map((w) => w.name))].filter((n) => !known.has(n.toLowerCase()));
      return {
        decision: { newCategories, assignments: wanted.map((w) => ({ ref: w.ref, categories: [w.name] })) },
        model: "stub",
        inputTokens: 0,
        outputTokens: 0,
      };
    },
  };
}
export const stubModel = createStubModel();

export const STUB_IDEAS: IdeaDraft[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  url: `https://example.com/stub-idea-${n}`,
  title: `Stub idea ${n}`,
  note: "A made-up place from the stub model.",
  category: null,
}));
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
