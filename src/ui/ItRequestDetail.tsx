"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { Textarea } from "@kabosh-digital/m-street-kit/ui/textarea";
import {
  acceptItChangeAction,
  answerItQuestionsAction,
  approveItSpecAction,
  cancelItRequestAction,
  getItDetailAction,
  requestItSpecChangesAction,
  type ItDetailView,
} from "../actions/it";
import type { ItQuestion } from "../domain/it/conversation";
import { ItFeed } from "./ItFeed";
import { ItFixSummary } from "./ItFixSummary";

const REFRESH_MS = 15_000;
const FINAL = ["MERGED", "LIVE", "DEPLOY_FAILED", "CLOSED", "APPLIED"];

/** One request: what the assistant asks, its plan to approve, and the finished change to try and accept. */
export function ItRequestDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<ItDetailView | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    getItDetailAction(id)
      .then(setDetail)
      .catch(() => setMessage("Could not load this request."));
  }, [id]);

  useEffect(() => {
    load();
    // Keep it current while it is open; work happens in the background.
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  /** Runs an action, shows its refusal if any, and refreshes. */
  function run(action: () => Promise<{ error: string | null }>, after?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setMessage(result.error);
      else after?.();
      load();
      onChanged();
    });
  }

  if (detail === undefined) return <p className="p-4 text-sm text-muted-foreground">{message ?? "Loading..."}</p>;
  if (detail === null) return <Shell onBack={onBack}><p className="text-sm">This request was not found.</p></Shell>;

  const { request, conversation, canApprove } = detail;
  const open = !FINAL.includes(request.status);
  const spec = conversation?.spec ?? null;
  const acceptance = conversation?.acceptance ?? null;
  const previewUrl = acceptance?.previewUrl ?? request.previewUrl;
  const problem = message ?? (detail.error ? `The assistant could not be reached: ${detail.error}` : detail.lastError);

  return (
    <Shell onBack={onBack}>
      <div>
        <p className="text-sm font-medium">{request.title}</p>
        <p className="text-xs text-muted-foreground">{request.number} - {request.requestedBy}</p>
        <p className={`mt-2 text-sm ${request.failed ? "text-destructive" : ""}`}>{request.statusLabel}</p>
        {request.waiting ? <p className="text-xs text-muted-foreground">{request.waiting}</p> : null}
      </div>

      {problem ? <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive">{problem}</p> : null}

      {detail.summary ? <ItFixSummary summary={detail.summary} /> : null}
      {detail.feed ? <ItFeed lines={detail.feed} /> : null}

      {detail.deploy ? (
        <section className="flex flex-col gap-1 rounded-xl border border-destructive/40 p-3">
          <h3 className="text-sm font-medium">The change did not go live</h3>
          <p className="text-sm">{detail.deploy.error}</p>
          {detail.deploy.fix ? (
            <p className="text-sm">The assistant is working on a fix: {detail.deploy.fix.number} ({detail.deploy.fix.statusLabel}). Open it in the list to try and accept it.</p>
          ) : (
            <p className="text-sm">Ask a developer to take a look.</p>
          )}
        </section>
      ) : null}

      {conversation && conversation.questions.length > 0 ? (
        <Questions questions={conversation.questions} pending={pending} onSend={(answers) => run(() => answerItQuestionsAction(id, answers))} />
      ) : null}

      {spec && request.status === "SPEC_REVIEW" ? (
        <section className="flex flex-col gap-2 rounded-xl border border-foreground/10 p-3">
          <h3 className="text-sm font-medium">The plan: {spec.title}</h3>
          <p className="text-sm">{spec.summary}</p>
          <List title="It will be done when" items={spec.acceptanceCriteria} />
          <List title="Things we considered" items={spec.edgeCases} />
          <List title="Left out" items={spec.outOfScope} />
          <PlanActions
            canApprove={canApprove}
            pending={pending}
            onApprove={() => run(() => approveItSpecAction(id, spec.version))}
            onChanges={(text, done) => run(() => requestItSpecChangesAction(id, spec.version, text), done)}
          />
        </section>
      ) : null}

      {request.status === "PROPOSED" && request.workflowId ? (
        <section className="flex flex-col gap-2 rounded-xl border border-foreground/10 p-3">
          <h3 className="text-sm font-medium">Review the prepared fix</h3>
          <p className="text-sm">The assistant prepared a change to the workflow that failed. Nothing has changed yet. Open the workflow, then the assistant: it shows what would change, and you choose whether to apply it.</p>
          <a href={`/definitions/${encodeURIComponent(request.workflowId)}/edit`} className="text-sm underline">
            Open the workflow &#8599;
          </a>
        </section>
      ) : null}

      {request.status === "PR_OPEN" ? (
        <section className="flex flex-col gap-2 rounded-xl border border-foreground/10 p-3">
          <h3 className="text-sm font-medium">{acceptance?.ready ? "Try it, then accept it" : "Getting it ready to try"}</h3>
          {previewUrl ? (
            <a href={previewUrl} target="_blank" rel="noreferrer" className="text-sm underline">
              Open the preview &#8599;
            </a>
          ) : (
            <p className="text-xs text-muted-foreground">The preview is not ready yet.</p>
          )}
          {request.needsDeveloper ? (
            <div role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
              <p className="font-medium">A developer must review this one</p>
              <p className="text-xs text-muted-foreground">
                It touches a sensitive part of the app: {request.protectedAreas.join(", ")}. It needs a developer&apos;s approval before it can go live.
              </p>
            </div>
          ) : null}
          {acceptance && !acceptance.ready ? <List title="Not ready yet" items={acceptance.blockers} /> : null}
          {canApprove ? (
            <Button disabled={pending || request.needsDeveloper || !acceptance?.ready || !acceptance.sha} onClick={() => run(() => acceptItChangeAction(id, acceptance!.sha!))}>
              {pending ? "Working..." : "Accept this change"}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">The Owner or Office accepts the change.</p>
          )}
        </section>
      ) : null}

      {open ? (
        <Button variant="ghost" size="sm" className="self-start text-muted-foreground" disabled={pending} onClick={() => run(() => cancelItRequestAction(id), onBack)}>
          Cancel this request
        </Button>
      ) : null}
    </Shell>
  );
}

function Shell({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={onBack}>
        &#8592; All requests
      </Button>
      {children}
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="list-disc pl-5 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Questions({ questions, pending, onSend }: { questions: ItQuestion[]; pending: boolean; onSend: (answers: { questionId: string; selected: string[]; other?: string }[]) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  function toggle(q: ItQuestion, label: string) {
    setPicked((prev) => {
      const now = prev[q.id] ?? [];
      const next = q.multiSelect ? (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]) : [label];
      return { ...prev, [q.id]: next };
    });
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-foreground/10 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSend(questions.map((q) => ({ questionId: q.id, selected: picked[q.id] ?? [], other: other[q.id] })));
      }}
    >
      <h3 className="text-sm font-medium">A few questions</h3>
      {questions.map((q) => (
        <fieldset key={q.id} className="flex flex-col gap-1.5">
          <legend className="text-sm">{q.question}</legend>
          {q.options.map((o) => (
            <label key={o.label} className="flex items-start gap-2 text-sm">
              <input type={q.multiSelect ? "checkbox" : "radio"} name={q.id} checked={(picked[q.id] ?? []).includes(o.label)} onChange={() => toggle(q, o.label)} className="mt-1" />
              <span>
                {o.label}
                {o.description ? <span className="block text-xs text-muted-foreground">{o.description}</span> : null}
              </span>
            </label>
          ))}
          <Textarea rows={2} placeholder={q.options.length ? "Or say it your own way" : "Your answer"} value={other[q.id] ?? ""} onChange={(e) => setOther((prev) => ({ ...prev, [q.id]: e.target.value }))} />
        </fieldset>
      ))}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Sending..." : "Send answers"}
      </Button>
    </form>
  );
}

function PlanActions({ canApprove, pending, onApprove, onChanges }: { canApprove: boolean; pending: boolean; onApprove: () => void; onChanges: (text: string, done: () => void) => void }) {
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-2">
      {asking ? (
        <>
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="What should change in the plan?" />
          <div className="flex gap-2">
            <Button size="sm" disabled={pending || !text.trim()} onClick={() => onChanges(text, () => { setAsking(false); setText(""); })}>
              Send
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canApprove ? <Button disabled={pending} onClick={onApprove}>{pending ? "Working..." : "Approve the plan"}</Button> : null}
          <Button variant="outline" disabled={pending} onClick={() => setAsking(true)}>Ask for changes</Button>
        </div>
      )}
      {!canApprove ? <p className="text-xs text-muted-foreground">The Owner or Office approves the plan.</p> : null}
    </div>
  );
}
