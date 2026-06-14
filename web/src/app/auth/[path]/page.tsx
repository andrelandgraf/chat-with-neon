import { AuthView } from "@neondatabase/auth-ui";
import { authViewPaths } from "@neondatabase/auth-ui/server";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.values(authViewPaths).map((path) => ({ path }));
}

export default async function AuthPage({
  params,
}: {
  params: Promise<{ path: string }>;
}) {
  const { path } = await params;
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-8 p-4">
      <div className="flex flex-col items-center gap-3 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://neon.com/brand/neon-logo-dark-color.svg"
          alt="Neon"
          className="h-8"
        />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Chat with Neon</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Realtime chat on Neon — with an{" "}
            <span className="text-neon font-medium">@neon</span> AI assistant.
          </p>
        </div>
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-card/50 p-1 shadow-2xl backdrop-blur-xl">
        <AuthView path={path} />
      </div>
    </main>
  );
}
