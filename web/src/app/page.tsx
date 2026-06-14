"use client";

import { SignedIn, SignedOut, RedirectToSignIn, UserButton } from "@neondatabase/auth-ui";
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
            <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://neon.com/brand/neon-logomark-dark-color.svg"
                  alt="Neon"
                  className="h-7 w-7"
                />
                <div className="leading-tight">
                  <h1 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                    Chat with Neon
                    <span className="bg-neon inline-block size-1.5 animate-pulse rounded-full shadow-[0_0_8px_var(--neon)]" />
                  </h1>
                  <p className="text-muted-foreground text-xs">
                    Signed in as {session?.user.name || session?.user.email}
                  </p>
                </div>
              </div>
              <UserButton size="icon" />
            </header>
            <Chat userName={session?.user.name || session?.user.email || "anon"} />
          </div>
        </main>
      </SignedIn>
    </>
  );
}
