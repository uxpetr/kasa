// Pure, so client components can import it without pulling in the database.
/** The six reactions, in picker order (D-154). */
export const REACTIONS = ["❤️", "👍", "😂", "😮", "🎉", "👀"] as const;
export type Reaction = (typeof REACTIONS)[number];
export const isReaction = (v: unknown): v is Reaction => typeof v === "string" && (REACTIONS as readonly string[]).includes(v);
