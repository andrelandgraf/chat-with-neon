"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X, Camera } from "lucide-react";
import { UserButton } from "@neondatabase/auth-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const WS_URL = process.env.NEXT_PUBLIC_CHAT_WS_URL!;
// The function speaks HTTP on the same host (image uploads) and WS (chat).
const HTTP_URL = WS_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

const MENTIONS = [{ name: "neon", desc: "Neon assistant" }];

// The @-token currently being typed at the end of the input (null if none).
function activeMentionQuery(text: string): string | null {
  const m = text.match(/(?:^|\s)@(\w*)$/);
  return m ? m[1].toLowerCase() : null;
}

type Message = {
  id: number;
  userId: string;
  userName: string;
  body: string;
  imageUrl: string | null;
  createdAt: string;
};

function normalize(raw: Record<string, unknown>): Message {
  return {
    id: Number(raw.id),
    userId: String(raw.userId ?? raw.user_id ?? ""),
    userName: String(raw.userName ?? raw.user_name ?? "anon"),
    body: String(raw.body ?? ""),
    imageUrl:
      typeof raw.imageUrl === "string"
        ? raw.imageUrl
        : typeof raw.image_url === "string"
          ? raw.image_url
          : null,
    createdAt: String(raw.createdAt ?? raw.created_at ?? ""),
  };
}

async function getToken(): Promise<string> {
  const res = await fetch("/api/auth/token", { credentials: "include" });
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("No token");
  return data.token;
}

export function Chat({ userId, userName }: { userId: string; userName: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Keep only the last 100 messages in view.
  function addMessage(msg: Message) {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].slice(-100)));
  }

  // Load history + profile pictures from the Next.js backend.
  useEffect(() => {
    fetch("/api/messages")
      .then((r) => r.json())
      .then((d: { messages?: Record<string, unknown>[] }) =>
        setMessages((d.messages ?? []).map(normalize).slice(-100)),
      )
      .catch(() => {});
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((d: { profiles?: Record<string, string> }) => setAvatars(d.profiles ?? {}))
      .catch(() => {});
  }, []);

  // Connect to the Neon Function WebSocket, reconnecting with backoff. Events are
  // typed: { type: "message", message } or { type: "delete", id } (moderation).
  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;

    async function connect() {
      if (closed) return;
      let token: string;
      try {
        token = await getToken();
      } catch {
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
        return;
      }
      const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data) as {
          type: string;
          message?: Record<string, unknown>;
          id?: number;
          userId?: string;
          avatarUrl?: string;
        };
        if (data.type === "message" && data.message) addMessage(normalize(data.message));
        else if (data.type === "delete" && typeof data.id === "number")
          setMessages((prev) => prev.filter((m) => m.id !== data.id));
        else if (data.type === "profile" && data.userId && data.avatarUrl)
          setAvatars((prev) => ({ ...prev, [data.userId!]: data.avatarUrl! }));
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${HTTP_URL}/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("upload failed");
      const data = (await res.json()) as { url: string };
      setPendingImage(data.url);
    } catch {
      // ignore; keep it simple
    } finally {
      setUploading(false);
    }
  }

  // Upload a profile picture; the function broadcasts a `profile` event so every
  // client (including this one) updates the avatar next to this user's messages.
  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const token = await getToken();
      const res = await fetch(`${HTTP_URL}/avatar`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("avatar upload failed");
      const data = (await res.json()) as { url: string };
      setAvatars((prev) => ({ ...prev, [userId]: data.url }));
    } catch {
      // ignore; keep it simple
    } finally {
      setUploadingAvatar(false);
    }
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if ((!body && !pendingImage) || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ body, imageUrl: pendingImage }));
    setDraft("");
    setPendingImage(null);
  }

  const mentionQuery = activeMentionQuery(draft);
  const suggestions =
    mentionQuery !== null ? MENTIONS.filter((m) => m.name.startsWith(mentionQuery)) : [];

  function selectMention(name: string) {
    setDraft((d) => d.replace(/@(\w*)$/, `@${name} `));
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (suggestions.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      selectMention(suggestions[0].name);
    }
  }

  return (
    <>
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
            <p className="text-muted-foreground text-xs">Signed in as {userName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={avatarFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={onPickAvatar}
          />
          <button
            type="button"
            onClick={() => avatarFileRef.current?.click()}
            disabled={uploadingAvatar}
            aria-label="Change your profile picture"
            title="Change your profile picture"
            className="group relative rounded-full disabled:opacity-60"
          >
            <Avatar userId={userId} name={userName} assistant={false} avatars={avatars} />
            <span className="bg-neon text-primary-foreground absolute -right-0.5 -bottom-0.5 grid size-3.5 place-items-center rounded-full ring-2 ring-card">
              <Camera className="size-2" />
            </span>
          </button>
          <UserButton size="icon" />
        </div>
      </header>

      <div className="scroll-slim flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://neon.com/brand/neon-logomark-dark-color.svg"
              alt=""
              className="size-10 opacity-80"
            />
            <p className="text-muted-foreground text-sm">
              No messages yet. Say hi — or tag{" "}
              <span className="text-neon font-medium">@neon</span> for help.
            </p>
          </div>
        )}
        {messages.map((m) => {
          const own = m.userId === userId;
          const assistant = m.userId === "neon-assistant" || m.userName === "Neon";
          return (
            <div
              key={m.id}
              className={`flex items-end gap-2.5 ${own ? "flex-row-reverse" : ""}`}
            >
              <Avatar userId={m.userId} name={m.userName} assistant={assistant} avatars={avatars} />
              <div className={`flex max-w-[78%] flex-col gap-1 ${own ? "items-end" : "items-start"}`}>
                {!own && (
                  <div className="flex items-center gap-1.5 px-1 text-xs">
                    <span className={assistant ? "text-neon font-semibold" : "text-foreground/90 font-medium"}>
                      {m.userName}
                    </span>
                    {assistant && (
                      <span className="bg-neon/15 text-neon rounded px-1 py-px text-[10px] font-medium tracking-wide uppercase">
                        AI
                      </span>
                    )}
                    <span className="text-muted-foreground/70">{fmtTime(m.createdAt)}</span>
                  </div>
                )}
                <div
                  className={`rounded-2xl border px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                    own
                      ? "border-neon/30 bg-neon/15 rounded-br-sm text-foreground"
                      : assistant
                        ? "border-neon/25 bg-neon-dim rounded-bl-sm text-foreground"
                        : "rounded-bl-sm border-white/5 bg-secondary/70 text-foreground"
                  }`}
                >
                  {m.body && <span>{m.body}</span>}
                  {m.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.imageUrl}
                      alt=""
                      className={`max-h-64 rounded-lg border border-white/10 ${m.body ? "mt-2" : ""}`}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {pendingImage && (
        <div className="flex items-center gap-2 border-t border-white/10 px-4 pt-3 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pendingImage} alt="" className="h-10 w-10 rounded-md object-cover ring-1 ring-white/10" />
          <span className="text-muted-foreground">Image attached</span>
          <button
            type="button"
            onClick={() => setPendingImage(null)}
            aria-label="Remove image"
            className="text-muted-foreground hover:text-foreground ml-auto"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <form onSubmit={send} className="relative flex items-center gap-2 border-t border-white/10 p-3">
        {suggestions.length > 0 && (
          <div className="bg-popover/95 absolute bottom-full left-3 mb-2 w-64 overflow-hidden rounded-xl border border-white/10 shadow-xl backdrop-blur">
            {suggestions.map((s) => (
              <button
                key={s.name}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMention(s.name);
                }}
                className="hover:bg-neon/10 flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://neon.com/brand/neon-logomark-dark-color.svg"
                  alt=""
                  className="size-5"
                />
                <span className="text-neon font-medium">@{s.name}</span>
                <span className="text-muted-foreground text-xs">{s.desc}</span>
              </button>
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={onPickImage}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          aria-label="Attach image"
        >
          <ImagePlus className="size-4" />
        </Button>
        <Input
          ref={inputRef}
          className="rounded-full"
          placeholder={connected ? "Message everyone… (try @neon)" : "Connecting…"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button type="submit" className="rounded-full px-5 font-semibold" disabled={!connected}>
          Send
        </Button>
      </form>
    </>
  );
}

function Avatar({
  userId,
  name,
  assistant,
  avatars,
}: {
  userId: string;
  name: string;
  assistant: boolean;
  avatars: Record<string, string>;
}) {
  if (assistant) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="https://neon.com/brand/neon-logomark-dark-color.svg"
        alt="Neon"
        className="ring-neon/40 size-8 shrink-0 rounded-full bg-black/40 p-1 ring-1"
      />
    );
  }
  const url = avatars[userId];
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        className="size-8 shrink-0 rounded-full object-cover ring-1 ring-white/10"
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="bg-secondary text-foreground grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 ring-white/10">
      {initial}
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
