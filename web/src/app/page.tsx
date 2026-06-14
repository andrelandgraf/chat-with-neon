"use client";

import { SignedIn, SignedOut, RedirectToSignIn } from "@neondatabase/auth-ui";
import { authClient } from "@/lib/auth/client";
import { Chat } from "@/components/chat";

export default function Home() {
  const { data: session } = authClient.useSession();

  return (
    <>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      <SignedIn>
        <main className="mx-auto flex h-[100dvh] max-w-2xl flex-col px-3 py-3 sm:px-4 sm:py-5">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-card/50 shadow-2xl backdrop-blur-xl">
            <Chat
              userId={session?.user.id || ""}
              userName={session?.user.name || session?.user.email || "anon"}
            />
          </div>
        </main>
      </SignedIn>
    </>
  );
}
