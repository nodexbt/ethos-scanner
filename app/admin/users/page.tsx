"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2, AlertTriangle } from "lucide-react";
import { AppHeader } from "@/components/app-header";

interface AllowedUser {
  profileId: number;
  addedBy: number;
  addedAt: number;
  note: string | null;
  twitterUsername: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  // @ts-expect-error - isAdmin field added in session callback
  const isAdmin = Boolean(session?.user?.isAdmin);
  // @ts-expect-error - ethos field added in session callback
  const ownProfileId: number | undefined = session?.user?.ethos?.profileId;

  const [users, setUsers] = useState<AllowedUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [identifier, setIdentifier] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [removingId, setRemovingId] = useState<number | null>(null);

  // Redirect non-admins (and unauthenticated users) to home
  useEffect(() => {
    if (status === "loading") return;
    if (!session || !isAdmin) {
      router.replace("/");
    }
  }, [session, isAdmin, status, router]);

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) {
        throw new Error(`Failed to load: ${res.status}`);
      }
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          note: note.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed: ${res.status}`);
      }
      setIdentifier("");
      setNote("");
      await loadUsers();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add user");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(profileId: number, displayName: string | null) {
    const label = displayName || `profile #${profileId}`;
    if (!confirm(`Remove ${label} from the allowlist?`)) return;
    setRemovingId(profileId);
    try {
      const res = await fetch(`/api/admin/users/${profileId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed: ${res.status}`);
      }
      await loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setRemovingId(null);
    }
  }

  if (status === "loading" || !session || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <AppHeader />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">Allowlist</CardTitle>
          <CardDescription>
            Manage which Ethos profiles can sign in. Removed users lose access within ~10 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Twitter handle, profile ID, or address"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={adding}
              className="flex-1"
            />
            <Input
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={adding}
              className="flex-1"
            />
            <Button type="submit" disabled={adding || !identifier.trim()}>
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add
            </Button>
          </form>
          {addError && (
            <div className="mt-3 flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{addError}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {users ? `${users.length} allowed` : "Loading..."}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !users && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive py-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {users && users.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No users in the allowlist yet.
            </p>
          )}
          {users && users.length > 0 && (
            <ul className="divide-y divide-border">
              {users.map((u) => {
                const isSelf = u.profileId === ownProfileId;
                return (
                  <li
                    key={u.profileId}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    {u.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={u.avatarUrl}
                        alt=""
                        className="h-9 w-9 rounded-md shrink-0"
                      />
                    ) : (
                      <div className="h-9 w-9 rounded-md bg-muted shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">
                          {u.displayName || `profile #${u.profileId}`}
                        </span>
                        {u.twitterUsername && (
                          <span className="text-xs text-muted-foreground">
                            @{u.twitterUsername}
                          </span>
                        )}
                        {isSelf && (
                          <span className="text-[10px] uppercase tracking-wide bg-muted px-1.5 py-0.5 rounded">
                            you
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {u.note ? `${u.note} · ` : ""}added {formatRelative(u.addedAt)}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(u.profileId, u.displayName)}
                      disabled={isSelf || removingId === u.profileId}
                      title={isSelf ? "Cannot remove yourself" : "Remove"}
                      className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {removingId === u.profileId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
