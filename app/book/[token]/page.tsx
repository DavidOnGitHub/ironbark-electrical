import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@kabosh-digital/m-street-kit/ui/card";
import { bookingPageData } from "../../../src/domain/booking";
import { bookByLinkAction } from "../../../src/actions/book";
import { CustomerPage } from "../../../src/ui/CustomerPage";
import { ActionForm } from "../../../src/ui/ActionForm";
import { Field } from "../../../src/ui/fields";
import { SlotPicker } from "../../../src/ui/SlotPicker";
import { formatDayTime, formatTime } from "../../../src/lib/tz";

export const dynamic = "force-dynamic";
// A private link: keep it out of search results.
export const metadata: Metadata = { title: "Choose a time", robots: { index: false, follow: false } };

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

/** The customer's page for choosing a site visit time: only times that are really free are offered. Public: the secret link is the credential. */
export default async function BookVisitPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const data = await bookingPageData(token);

  return (
    <CustomerPage>
      {!data ? (
        <Notice title="We cannot find that booking">
          <p>This link is not valid. Please use the link in your latest email from us, or reply to that email and we will help.</p>
        </Notice>
      ) : (
        <>
          {data.booked ? (
            <Card data-testid="visit-booked">
              <CardHeader>
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Ironbark Electrical</p>
                <CardTitle className="text-xl">Your site visit is booked</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <p className="text-lg font-semibold">{formatDayTime(data.booked.scheduledStart)} - {formatTime(data.booked.scheduledEnd)}</p>
                {data.knownAddress ? <p className="text-muted-foreground">At {data.knownAddress}</p> : null}
                <p className="text-muted-foreground">An electrician will look at the job and we will send your quote afterwards. Need a different time? Choose another below.</p>
              </CardContent>
            </Card>
          ) : null}

          {!data.open ? (
            <Notice title="Your quote is on its way">
              <p>We have already looked at your request, so a site visit is no longer needed. Reply to our email if you would still like us to come out.</p>
            </Notice>
          ) : data.days.length === 0 ? (
            <Notice title="No times available right now">
              <p>We are fully booked for the next two weeks. Reply to our email and we will find a time that works.</p>
            </Notice>
          ) : (
            <Card>
              <CardHeader>
                {data.booked ? null : <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Ironbark Electrical</p>}
                <CardTitle className="text-xl">{data.booked ? "Change your time" : "Choose a time for our electrician to visit"}</CardTitle>
                <p className="text-sm text-muted-foreground">About an hour, free of charge. {data.request.summary}</p>
              </CardHeader>
              <CardContent>
                <ActionForm action={bookByLinkAction} submitLabel={data.booked ? "Move my visit" : "Book this time"} pendingLabel="Booking..." successMessage="Booked - thank you.">
                  <input type="hidden" name="token" value={token} />
                  <SlotPicker days={data.days} />
                  {data.needsName ? <Field label="Your name" name="name" required /> : null}
                  {data.needsPhone ? <Field label="Phone number" name="phone" type="tel" required hint="So the electrician can call when they are on the way." /> : null}
                  {data.needsAddress ? (
                    <div className="flex flex-col gap-3 rounded-lg border p-3">
                      <p className="text-sm font-medium">Where should we come?</p>
                      <Field label="Street address" name="line1" required />
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Suburb" name="suburb" required />
                        <Field label="State" name="state" defaultValue="NSW" />
                        <Field label="Postcode" name="postcode" required />
                      </div>
                      <Field label="Access notes (optional)" name="accessNotes" placeholder="Gate code, dog in the yard, call from the street..." />
                    </div>
                  ) : data.knownAddress ? (
                    <p className="text-sm text-muted-foreground">We will visit {data.knownAddress}.</p>
                  ) : null}
                </ActionForm>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </CustomerPage>
  );
}
