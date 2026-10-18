import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { getQuoteByToken } from "../../../src/domain/quotes";
import { answerQuoteAction, chooseJobSlotAction } from "../../../src/actions/accept";
import { jobSlotPageData } from "../../../src/domain/booking";
import { SlotPicker } from "../../../src/ui/SlotPicker";
import { CustomerPage } from "../../../src/ui/CustomerPage";
import { ActionForm } from "../../../src/ui/ActionForm";
import { formatMoney } from "../../../src/lib/money";

export const dynamic = "force-dynamic";
// A private link: keep it out of search results.
export const metadata: Metadata = { title: "Your quote", robots: { index: false, follow: false } };

const date = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {children}
        <p className="mt-3">Ironbark Electrical</p>
      </CardContent>
    </Card>
  );
}

/** The customer's page for their quote: read it, then accept or decline. Public: the secret link is the credential. */
export default async function AcceptQuotePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const quote = await getQuoteByToken(token);
  const slots = quote?.effectiveStatus === "APPROVED" ? await jobSlotPageData(token) : null;

  return (
    <CustomerPage>
      {!quote ? (
        <Notice title="We cannot find that quote">
          <p>This link is not valid. Please use the link in your latest email from us, or reply to that email and we will help.</p>
        </Notice>
      ) : (
        <>
          <Card>
            <CardHeader>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Ironbark Electrical - quote {quote.number}</p>
              <CardTitle className="text-xl">{quote.title}</CardTitle>
              <p className="text-sm text-muted-foreground">Prepared for {quote.client.name}</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Item</th>
                      <th className="px-3 py-2 text-right font-semibold">Qty</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.lines.map((l) => (
                      <tr key={l.id} className="border-b last:border-0">
                        <td className="px-3 py-2">{l.description}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(l.quantity)} {l.unit}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.lineTotalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="ml-auto grid w-full max-w-60 grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Subtotal</dt><dd className="text-right tabular-nums">{formatMoney(quote.subtotalCents)}</dd>
                <dt className="text-muted-foreground">GST</dt><dd className="text-right tabular-nums">{formatMoney(quote.gstCents)}</dd>
                <dt className="font-semibold">Total</dt><dd className="text-right font-semibold tabular-nums">{formatMoney(quote.totalCents)}</dd>
              </dl>
              {quote.depositCents > 0 ? <p className="text-sm">A deposit of <strong>{formatMoney(quote.depositCents)}</strong> is needed to book the work in.</p> : null}
              {quote.notes ? <p className="text-sm whitespace-pre-line text-muted-foreground">{quote.notes}</p> : null}
              <p className="text-xs text-muted-foreground">All prices include GST. Valid until {date(quote.validUntil)}.</p>
            </CardContent>
          </Card>

          {quote.effectiveStatus === "SENT" ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Would you like us to go ahead?</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-5">
                <ActionForm action={answerQuoteAction} submitLabel="Accept this quote" pendingLabel="Sending..." successMessage="Thank you.">
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="decision" value="APPROVED" />
                  <p className="text-sm text-muted-foreground">You will pick a date for the work next.</p>
                </ActionForm>
                <ActionForm action={answerQuoteAction} submitLabel="Decline" pendingLabel="Sending..." variant="outline" successMessage="Thank you.">
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="decision" value="DECLINED" />
                  <label className="text-sm font-medium" htmlFor="reason">Not for you? Tell us why (optional)</label>
                  <textarea id="reason" name="reason" rows={2} maxLength={1000} placeholder="Price, timing, went with someone else..." className="w-full rounded-lg border border-input bg-card px-2.5 py-1.5 text-sm" />
                </ActionForm>
                <p className="text-xs text-muted-foreground">Questions first? Just reply to the email we sent you.</p>
              </CardContent>
            </Card>
          ) : quote.effectiveStatus === "APPROVED" && slots?.state === "booked" ? (
            <Card data-testid="job-booked">
              <CardHeader><CardTitle>Your job is booked</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <p className="text-lg font-semibold">{slots.when}</p>
                <p className="text-muted-foreground">{slots.technician} will be there{slots.address ? ` at ${slots.address}` : ""}. Need to change it? Reply to our email.</p>
              </CardContent>
            </Card>
          ) : quote.effectiveStatus === "APPROVED" && slots ? (
            <>
              {slots.state === "held" ? (
                <Card data-testid="job-held">
                  <CardHeader><CardTitle>Thank you - quote accepted</CardTitle></CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <p className="text-lg font-semibold">{slots.when}</p>
                    <p className="text-muted-foreground">We are holding this time for you with {slots.technician}. The office will confirm it shortly and you will get an email. Prefer another day? Choose below.</p>
                  </CardContent>
                </Card>
              ) : null}
              {slots.days.length === 0 ? (
                <Notice title="No days available right now">
                  <p>We are fully booked for the next two weeks. Reply to our email and we will find a day that works.</p>
                </Notice>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{slots.state === "held" ? "Change the day" : "Thank you - now choose a day for the work"}</CardTitle>
                    <p className="text-sm text-muted-foreground">Allow about {Math.round(slots.durationMinutes / 30) / 2} hours on site. Pick the time we should arrive.</p>
                  </CardHeader>
                  <CardContent>
                    <ActionForm action={chooseJobSlotAction} submitLabel={slots.state === "held" ? "Change my time" : "Book this time"} pendingLabel="Booking..." successMessage="Thank you.">
                      <input type="hidden" name="token" value={token} />
                      <SlotPicker days={slots.days} />
                    </ActionForm>
                  </CardContent>
                </Card>
              )}
            </>
          ) : quote.effectiveStatus === "APPROVED" ? (
            <Notice title="Thank you - quote accepted">
              <p>We have your acceptance{quote.decidedAt ? ` (${date(quote.decidedAt)})` : ""} and will be in touch to lock in a date.</p>
            </Notice>
          ) : quote.effectiveStatus === "DECLINED" ? (
            <Notice title="Quote declined">
              <p>We have noted that you do not wish to go ahead. If you change your mind, reply to our email and we will gladly help.</p>
            </Notice>
          ) : (
            <Notice title="This quote has expired">
              <p>It was valid until {date(quote.validUntil)}. Reply to our email and we will gladly refresh it for you.</p>
            </Notice>
          )}
        </>
      )}
    </CustomerPage>
  );
}
