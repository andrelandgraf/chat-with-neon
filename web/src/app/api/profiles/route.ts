import { db } from "@/lib/db";
import { profiles } from "@/db/schema";
import { auth } from "@/lib/auth/server";

// Returns a { userId: avatarUrl } map of all profile pictures, so the client can
// render the right avatar next to each message. Gated on a Neon Auth session.
export async function GET() {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({ userId: profiles.userId, avatarUrl: profiles.avatarUrl })
    .from(profiles);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.userId] = r.avatarUrl;
  return Response.json({ profiles: map });
}
