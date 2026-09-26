import { headers } from "next/headers";
import { connection } from "next/server";
import { getAuth, isAuthConfigured, isGoogleSignInConfigured } from "@/lib/auth";
import { SignInButton, SignOutButton } from "./auth-buttons";

// Placeholder home until the projects screen (P-02) and landing page (V-12).
export default async function Home() {
  await connection();
  const session = isAuthConfigured() ? await getAuth().api.getSession({ headers: await headers() }) : null;

  return (
    <main>
      <h1>Kasa</h1>
      {session ? (
        <p>
          Signed in as {session.user.name} <SignOutButton />
        </p>
      ) : isGoogleSignInConfigured() ? (
        <SignInButton />
      ) : null}
    </main>
  );
}
