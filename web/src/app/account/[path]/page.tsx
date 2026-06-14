import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccountView } from "@neondatabase/auth-ui";
import { accountViewPaths } from "@neondatabase/auth-ui/server";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.values(accountViewPaths).map((path) => ({ path }));
}

export default async function AccountPage({
  params,
}: {
  params: Promise<{ path: string }>;
}) {
  const { path } = await params;
  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-3xl px-4 py-6 sm:py-10">
      <div className="mb-8 flex items-center justify-between gap-3">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to chat
        </Link>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://neon.com/brand/neon-logomark-dark-color.svg"
          alt="Neon"
          className="size-6"
        />
      </div>
      <AccountView path={path} />
    </main>
  );
}
