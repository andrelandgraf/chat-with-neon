import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WebSocketServer, type WebSocket } from 'ws';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, Client } from 'pg';
import { eq, desc } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { parseEnv } from '@neondatabase/env/v1';
import config from '../neon';
import { messages, profiles } from './db/schema';
import { putImage, presignImage } from './lib/storage';
import { moderateMessage } from './lib/moderation';
import { mentionsNeon, runAssistant } from './lib/assistant';

const env = parseEnv(config);

const pool = new Pool({ connectionString: env.postgres.databaseUrl, max: 5 });
const db = drizzle(pool);

// Neon Auth signs tokens with the auth server's origin as the issuer.
const jwks = createRemoteJWKSet(new URL(env.auth.jwksUrl));
const issuer = new URL(env.auth.baseUrl).origin;

type Identity = { id: string; name: string };

async function verifyToken(token: string | null | undefined): Promise<Identity | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer });
    if (typeof payload.sub !== 'string') return null;
    const name =
      typeof payload.name === 'string'
        ? payload.name
        : typeof payload.email === 'string'
          ? payload.email
          : 'anon';
    return { id: payload.sub, name };
  } catch {
    return null;
  }
}

// Sockets connected to THIS isolate. Several isolates can run under load, so we
// fan events out across all of them with Postgres LISTEN/NOTIFY rather than only
// broadcasting in-process. Events are typed: a new `message` or a `delete`.
const clients = new Set<WebSocket>();
const CHANNEL = 'chat_events';

const listener = new Client({ connectionString: env.postgres.databaseUrlUnpooled });
listener
  .connect()
  .then(() => listener.query(`LISTEN ${CHANNEL}`))
  .catch((error) => console.error('[listen] failed:', error));
listener.on('notification', (msg) => {
  if (!msg.payload) return;
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg.payload);
  }
});

function notify(event: unknown): Promise<unknown> {
  return pool.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(event)]);
}

// Moderation runs AFTER the message is broadcast (so it appears instantly), then
// retroactively deletes + broadcasts a delete event if the agent flags it.
async function moderateAndMaybeDelete(id: number, body: string): Promise<void> {
  try {
    const { flagged } = await moderateMessage(body);
    if (!flagged) return;
    await db.delete(messages).where(eq(messages.id, id));
    await notify({ type: 'delete', id });
  } catch (error) {
    console.error('[moderation] post-process failed:', error);
  }
}

// When a message tags @neon, the assistant reads the recent transcript and posts
// its own reply back into the chat (broadcast like any other message).
async function handleNeonMention(): Promise<void> {
  try {
    const recent = await db
      .select({ userName: messages.userName, body: messages.body, imageUrl: messages.imageUrl })
      .from(messages)
      .orderBy(desc(messages.createdAt))
      .limit(20);
    const reply = await runAssistant(recent.reverse());
    if (!reply) return;
    const [row] = await db
      .insert(messages)
      .values({ userId: 'neon-assistant', userName: 'Neon', body: reply })
      .returning();
    await notify({ type: 'message', message: row });
  } catch (error) {
    console.error('[assistant] failed:', error);
  }
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const app = new Hono();

app.get('/', (c) => c.text('Chat with Neon — connect over WebSocket with ?token=<jwt>'));

// Image upload is a normal authenticated HTTP request (you can't stream a file
// over the chat WebSocket): the client uploads here, gets a URL back, then sends
// a chat message referencing it. JWT-gated + CORS for the cross-origin web app.
app.use('/upload', cors({ origin: (o) => o ?? '*', allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['authorization', 'content-type'] }));
app.post('/upload', async (c) => {
  const identity = await verifyToken(c.req.header('authorization')?.replace(/^Bearer\s+/i, ''));
  if (!identity) return c.json({ error: 'Unauthorized' }, 401);

  const contentType = c.req.header('content-type') ?? '';
  const ext = EXT[contentType];
  if (!ext) return c.json({ error: 'Unsupported image type' }, 415);

  const body = Buffer.from(await c.req.arrayBuffer());
  if (body.byteLength === 0) return c.json({ error: 'Empty body' }, 400);
  if (body.byteLength > MAX_IMAGE_BYTES) return c.json({ error: 'Image too large' }, 413);

  const key = `${identity.id}/${randomUUID()}.${ext}`;
  await putImage(key, body, contentType);
  const url = await presignImage(key);
  return c.json({ url });
});

// Profile picture upload: same JWT-gated pattern, but stored under a stable key
// per user (so re-uploads overwrite) and persisted to the `profiles` table. We
// broadcast a `profile` event so every connected client updates that user's
// avatar live, next to all of their messages.
app.use('/avatar', cors({ origin: (o) => o ?? '*', allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['authorization', 'content-type'] }));
app.post('/avatar', async (c) => {
  const identity = await verifyToken(c.req.header('authorization')?.replace(/^Bearer\s+/i, ''));
  if (!identity) return c.json({ error: 'Unauthorized' }, 401);

  const contentType = c.req.header('content-type') ?? '';
  const ext = EXT[contentType];
  if (!ext) return c.json({ error: 'Unsupported image type' }, 415);

  const body = Buffer.from(await c.req.arrayBuffer());
  if (body.byteLength === 0) return c.json({ error: 'Empty body' }, 400);
  if (body.byteLength > MAX_IMAGE_BYTES) return c.json({ error: 'Image too large' }, 413);

  const key = `avatars/${identity.id}.${ext}`;
  await putImage(key, body, contentType);
  const url = await presignImage(key);
  await db
    .insert(profiles)
    .values({ userId: identity.id, avatarUrl: url })
    .onConflictDoUpdate({ target: profiles.userId, set: { avatarUrl: url, updatedAt: new Date() } });
  await notify({ type: 'profile', userId: identity.id, avatarUrl: url });
  return c.json({ url });
});

const wss = new WebSocketServer({ noServer: true });

export default {
  fetch: (request: Request) => app.fetch(request),

  async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const identity = await verifyToken(url.searchParams.get('token'));
    if (!identity) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.on('message', async (data) => {
        // The client sends JSON: { body, imageUrl? }. Fall back to plain text.
        let body = '';
        let imageUrl: string | null = null;
        const raw = data.toString();
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            const p = parsed as { body?: unknown; imageUrl?: unknown };
            if (typeof p.body === 'string') body = p.body.slice(0, 2000).trim();
            if (typeof p.imageUrl === 'string') imageUrl = p.imageUrl;
          }
        } catch {
          body = raw.slice(0, 2000).trim();
        }
        if (!body && !imageUrl) return;

        const [row] = await db
          .insert(messages)
          .values({ userId: identity.id, userName: identity.name, body, imageUrl })
          .returning();
        // Broadcast immediately so the message shows up in realtime…
        await notify({ type: 'message', message: row });
        // …then moderate the text and retroactively delete if it's flagged.
        if (body) void moderateAndMaybeDelete(row.id, body);
        // If the message tags @neon, the assistant replies.
        if (body && mentionsNeon(body)) void handleNeonMention();
      });
    });
  },
};

process.on('SIGINT', () => {
  Promise.allSettled([pool.end(), listener.end()]).then(() => process.exit(0));
});
