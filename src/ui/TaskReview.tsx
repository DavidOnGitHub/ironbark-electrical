import type { Review } from "../domain/approvals/review";

/** "What you are approving": the email that will go out, or the settings of the step being approved. */
export function TaskReview({ review }: { review: Review }) {
  return (
    <section aria-label="What you are approving" className="mt-3 rounded-md border bg-muted/40 p-3 text-sm" data-testid="task-review">
      <p className="mb-2 text-[0.8rem] font-semibold tracking-wide text-muted-foreground uppercase">Approving: {review.stepLabel}</p>
      {review.kind === "email" ? (
        <div className="flex flex-col gap-2">
          <p><span className="text-muted-foreground">To: </span><span className="font-medium" data-testid="review-to">{review.to}</span></p>
          <p><span className="text-muted-foreground">Subject: </span><span className="font-medium" data-testid="review-subject">{review.subject}</span></p>
          <iframe title="Email to be sent" sandbox="" srcDoc={review.html} className="h-[30rem] w-full rounded-md border bg-white" data-testid="review-frame" />
        </div>
      ) : null}
      {review.kind === "plain-email" ? (
        <div className="flex flex-col gap-2">
          <p><span className="text-muted-foreground">To: </span><span className="font-medium">{review.to}</span></p>
          <p><span className="text-muted-foreground">Subject: </span><span className="font-medium">{review.subject}</span></p>
          <pre className="max-h-96 overflow-auto rounded-md border bg-card p-3 font-sans whitespace-pre-wrap">{review.body}</pre>
        </div>
      ) : null}
      {review.kind === "fields" ? (
        <dl className="grid gap-1">
          {review.rows.map((r) => (
            <div key={r.label} className="flex gap-2"><dt className="min-w-32 text-muted-foreground">{r.label}</dt><dd className="font-medium break-words">{r.value}</dd></div>
          ))}
        </dl>
      ) : null}
      {review.kind === "problem" ? <p role="alert" className="text-status-warn">The content could not be shown: {review.message}</p> : null}
    </section>
  );
}
