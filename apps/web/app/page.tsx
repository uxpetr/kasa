import { headers } from "next/headers";
import { connection } from "next/server";
import { getAuth, isAuthConfigured, isGoogleSignInConfigured } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listPiles } from "@/lib/piles";
import { getStorage } from "@/lib/services";
import { accountTelegram } from "@/lib/telegram";
import { SignInButton } from "./auth-buttons";
import { PilesScreen } from "./piles-screen";

// Signed in: your projects (P-02). Signed out: a placeholder until the landing page (V-12).
export default async function Home() {
  await connection();
  const session = isAuthConfigured() ? await getAuth().api.getSession({ headers: await headers() }) : null;

  if (session) {
    const user = { id: session.user.id, name: session.user.name };
    const [piles, telegram] = await Promise.all([listPiles({ db: getDb(), storage: getStorage() }, user.id), accountTelegram(getDb(), user.id)]);
    return <PilesScreen user={user} piles={piles} telegram={telegram} />;
  }
  return (
    <main>
      <h1>Kasa</h1>
      {isGoogleSignInConfigured() ? <SignInButton /> : null}
    </main>
  );
}
