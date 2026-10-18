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
          {review.attachments?.length ? <p data-testid="review-attachments"><span className="text-muted-foreground">Attached: </span><span className="font-medium">{review.attachments.join(", ")}</span></p> : null}
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
      {review.kind === "booking" ? (
        <div className="flex flex-col gap-1.5" data-testid="review-booking">
          <p><span className="font-semibold">{review.jobNumber}</span> {review.title} - for {review.clientName}{review.totalText ? ` (quote ${review.totalText})` : ""}</p>
          {review.problem ? <p role="alert" className="text-status-warn">{review.problem}</p> : null}
          {review.requestedText ? <p><span className="text-muted-foreground">Customer chose: </span><span className="font-semibold" data-testid="review-when">{review.requestedText}</span>{review.technician ? <span> with {review.technician}</span> : null}</p> : null}
          {review.address ? <p><span className="text-muted-foreground">At: </span>{review.address}</p> : null}
          <p className="text-xs text-muted-foreground">That time is held for this customer and nobody else can book it. Approving puts the job in the technician&rsquo;s calendar and emails the customer.</p>
        </div>
      ) : null}
      {review.kind === "invoice" ? (
        <div className="flex flex-col gap-3" data-testid="review-invoice">
          <p><span className="font-semibold">{review.number}</span> {review.title} - for {review.clientName}</p>
          {review.problem ? <p role="alert" className="text-status-warn">{review.problem}</p> : null}
          <table className="w-full text-sm">
            <tbody>
              {review.lines.map((l, i) => (
                <tr key={i} className="border-b last:border-0"><td className="py-1 pr-3">{l.description}</td><td className="py-1 pr-3 text-right tabular-nums">{l.quantity}</td><td className="py-1 text-right tabular-nums">{l.totalText}</td></tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto grid w-full max-w-64 grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Subtotal</dt><dd className="text-right tabular-nums">{review.subtotalText}</dd>
            <dt className="text-muted-foreground">GST</dt><dd className="text-right tabular-nums">{review.gstText}</dd>
            <dt className="text-muted-foreground">Total</dt><dd className="text-right tabular-nums">{review.totalText}</dd>
            {review.creditText ? <><dt className="text-muted-foreground">Deposit paid</dt><dd className="text-right tabular-nums">-{review.creditText}</dd></> : null}
            <dt className="font-semibold">Amount due</dt><dd className="text-right font-semibold tabular-nums">{review.balanceText}</dd>
          </dl>
          {review.notes ? <p className="whitespace-pre-wrap text-muted-foreground">{review.notes}</p> : null}
          <p className="text-xs text-muted-foreground">Approving issues the invoice and emails it to the customer with the invoice attached as a PDF and our bank details.</p>
          <p className="flex flex-wrap gap-4">
            <a href={`/invoices/${review.invoiceId}`} className="font-semibold text-link underline" data-testid="review-edit-invoice">Open the invoice to edit it &rarr;</a>
            <a href={`/invoices/${review.invoiceId}/pdf`} target="_blank" rel="noreferrer" className="font-semibold text-link underline" data-testid="review-invoice-pdf">Preview the PDF &rarr;</a>
          </p>
        </div>
      ) : null}
      {review.kind === "quote" ? (
        <div className="flex flex-col gap-3" data-testid="review-quote">
          <p><span className="font-semibold">{review.number}</span> {review.title} - for {review.clientName}</p>
          {review.problem ? <p role="alert" className="text-status-warn">{review.problem}</p> : null}
          <table className="w-full text-sm">
            <tbody>
              {review.lines.map((l, i) => (
                <tr key={i} className="border-b last:border-0"><td className="py-1 pr-3">{l.description}</td><td className="py-1 pr-3 text-right tabular-nums">{l.quantity}</td><td className="py-1 text-right tabular-nums">{l.totalText}</td></tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto grid w-full max-w-60 grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Subtotal</dt><dd className="text-right tabular-nums">{review.subtotalText}</dd>
            <dt className="text-muted-foreground">GST</dt><dd className="text-right tabular-nums">{review.gstText}</dd>
            <dt className="font-semibold">Total</dt><dd className="text-right font-semibold tabular-nums">{review.totalText}</dd>
          </dl>
          {review.notes ? <p className="whitespace-pre-wrap text-muted-foreground">{review.notes}</p> : null}
          <p><a href={`/quotes/${review.quoteId}`} className="font-semibold text-link underline" data-testid="review-edit-quote">Open the quote to edit it &rarr;</a></p>
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
