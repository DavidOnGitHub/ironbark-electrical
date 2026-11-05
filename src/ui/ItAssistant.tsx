"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useAssistantDock } from "@kabosh-digital/m-street-kit/components/AssistantDockContext";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Input } from "@kabosh-digital/m-street-kit/ui/input";
import { Textarea } from "@kabosh-digital/m-street-kit/ui/textarea";
import { listItRequestsAction, refreshItRequestAction, submitItRequestAction, type ItRequestView } from "../actions/it";

const DOCK_ID = "it";
const LABEL = "IT assistant";
/** Placeholder picture until the assistant has its own art. */
const PICTURE = "/it-assistant.svg";
const LAUNCHER_PROPS = {};

/**
 * The IT assistant as a dock entry beside the Business Master and the Workflow expert: ask for a change to this app,
 * and follow it from idea to live. It registers with the floating dock and renders into the slot the dock gives it,
 * so it stays mounted (and keeps its state) while the panel is closed.
 */
export function ItAssistant() {
  const dock = useAssistantDock();
  const pathname = usePathname();
  const [requests, setRequests] = useState<ItRequestView[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const register = dock?.register;
  const setMeta = dock?.setMeta;
  useEffect(() => register?.({ id: DOCK_ID, label: LABEL }), [register]);
  useEffect(() => {
    setMeta?.(DOCK_ID, { state: "idle", characterId: "default", imageSrc: PICTURE, name: LABEL, launcherProps: LAUNCHER_PROPS });
  }, [setMeta]);

  const active = dock?.isActive(DOCK_ID) ?? false;
  const load = useCallback(() => {
    listItRequestsAction()
      .then(setRequests)
      .catch(() => setError("Could not load your requests."));
  }, []);
  // Reload each time the panel is opened on this assistant.
  useEffect(() => {
    if (active) load();
  }, [active, load]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await submitItRequestAction({ title, description, page: pathname });
      if (result.error) return setError(result.error);
      setTitle("");
      setDescription("");
      setComposing(false);
      load();
    });
  }

  function refresh(id: string) {
    startTransition(async () => {
      const updated = await refreshItRequestAction(id);
      if (updated) setRequests((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? prev);
    });
  }

  const slot = dock?.slot(DOCK_ID);
  if (!slot) return null;

  return createPortal(
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-foreground/10 px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- small fixed placeholder */}
        <img src={PICTURE} alt="" className="size-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{LABEL}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Ask for a change to this app</p>
        </div>
        {!composing ? (
          <Button size="sm" onClick={() => setComposing(true)}>
            New request
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {composing ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="flex flex-col gap-1 text-sm font-medium">
              What do you want changed?
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A short name for it" maxLength={200} required />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Tell us more
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What should it do, and who is it for?" rows={6} required />
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Sending..." : "Send request"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setComposing(false); setError(null); }}>
                Cancel
              </Button>
            </div>
          </form>
        ) : requests === null ? (
          <p className="text-sm text-muted-foreground">{error ?? "Loading..."}</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet. Choose New request to ask for a change.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {requests.map((r) => (
              <li key={r.id} className="rounded-xl border border-foreground/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{r.number} - {r.requestedBy}</p>
                  </div>
                  <Button variant="ghost" size="icon" title="Refresh" aria-label={`Refresh ${r.number}`} disabled={pending} onClick={() => refresh(r.id)}>
                    <span aria-hidden>&#8635;</span>
                  </Button>
                </div>
                <p className={`mt-2 text-sm ${r.failed ? "text-destructive" : ""}`}>{r.statusLabel}</p>
                {r.waiting ? <p className="text-xs text-muted-foreground">{r.waiting}</p> : null}
                {r.previewUrl ? (
                  <a href={r.previewUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline">
                    Try the change &#8599;
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    slot,
  );
}
