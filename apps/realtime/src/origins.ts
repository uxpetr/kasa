/**
 * Browser origins allowed to connect: REALTIME_ALLOWED_ORIGINS, else BETTER_AUTH_URL, else the
 * local web app. Blank values count as unset, so `REALTIME_ALLOWED_ORIGINS=` in a copied .env
 * doesn't refuse every connection.
 */
export function allowedOriginsFrom(env: NodeJS.ProcessEnv): string[] {
  const list = (value: string | undefined) =>
    (value ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  const configured = list(env.REALTIME_ALLOWED_ORIGINS);
  if (configured.length) return configured;
  const auth = list(env.BETTER_AUTH_URL);
  return auth.length ? auth : ["http://localhost:3000"];
}
