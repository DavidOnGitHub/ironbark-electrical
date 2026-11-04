# Delivery: jobs, site visits and scheduling

Rules marked "(inferred)" come from the code only and are not confirmed by a test or doc.

## Jobs (JOB)

- BR-JOB-1: A job is created only from an approved quote, numbered J-2001 upward, and records the quote's subtotal as the quoted amount.
- BR-JOB-2: Office and Owner move a job only along: UNSCHEDULED to SCHEDULED; SCHEDULED to IN_PROGRESS, ON_HOLD or UNSCHEDULED; IN_PROGRESS to COMPLETED or ON_HOLD; ON_HOLD to SCHEDULED or IN_PROGRESS; COMPLETED to INVOICED; INVOICED to PAID; PAID is final.
- BR-JOB-3: A technician may move only their own assigned job, and only SCHEDULED to IN_PROGRESS, IN_PROGRESS to COMPLETED or ON_HOLD, and ON_HOLD to IN_PROGRESS.
- BR-JOB-4: The technician restriction is enforced in the jobs module (a job not assigned to the technician is refused), not only in the UI.
- BR-JOB-5: The first move to IN_PROGRESS stamps the start time and a move to COMPLETED stamps the completion time.
- BR-JOB-6: Active (open) work means UNSCHEDULED, SCHEDULED, IN_PROGRESS or ON_HOLD.
- BR-JOB-7: INVOICED and PAID are set only by the invoicing module, which also moves INVOICED back to COMPLETED when an invoice is voided.
- BR-JOB-8: A job can be (re)scheduled only while UNSCHEDULED, SCHEDULED or ON_HOLD; scheduling sets it to SCHEDULED, clears any customer hold, and needs a technician and an end after the start, with a slot of at most 24 hours.
- BR-JOB-9: Only a SCHEDULED job can be unscheduled.
- BR-JOB-10: Scheduling is refused when the technician already has an overlapping SCHEDULED, IN_PROGRESS or ON_HOLD job or an unexpired customer hold, unless the office explicitly allows the conflict; windows that only touch end-to-start do not overlap.
- BR-JOB-11: A note is 1-2,000 characters; a variation is a note that also needs an extra amount above zero (ex GST, at most $100,000.00).
- BR-JOB-12: Only a variation can be approved or unapproved, and only approved variations are billed.
- BR-JOB-13: A technician can add notes only to a job assigned to them.
- BR-JOB-14: A customer-chosen time is held for 3 days; a hold blocks that technician's calendar until the office approves it, it lapses afterwards, and picking again moves the hold.
- BR-JOB-15: A hold can be placed only on an UNSCHEDULED job, needs an end after the start, and is refused when the time clashes with a booked job or another unexpired hold.
- BR-JOB-16: Confirming a hold schedules the job for the held technician and time; it fails when there is no live hold.

## Site visits and booking (SCH)

- BR-SCH-1: A site visit needs a technician and an end after the start, and lasts at most 8 hours; customer self-booked visits last 60 minutes.
- BR-SCH-2: A site visit can be booked only for an enquiry that is linked to a client and is NEW, CONTACTED or SITE_VISIT_BOOKED; booking again moves the enquiry's scheduled visit instead of creating a second one.
- BR-SCH-3: Booking is refused when the technician has an overlapping job or visit, unless the office explicitly allows the conflict.
- BR-SCH-4: Only a SCHEDULED visit can be completed or cancelled, and a technician can act only on a visit assigned to them.
- BR-SCH-5: A customer's booking link is valid only if its token is at least 16 characters; booking by link is refused once the enquiry is no longer open for a visit (inferred: the exact condition is in `bookingPageData`), needs a phone number when none is on file, and needs an address when no site is known.
- BR-SCH-6: A customer can book only a time currently offered as free; otherwise they are told it has just been taken.
- BR-SCH-7: Customer booking creates the client and site if the enquiry has none, and links the enquiry to them.
- BR-SCH-8: Availability uses working hours 8:00-16:00 Sydney time, Monday to Friday, slots starting on the hour, a 30-minute travel buffer either side of any booking, and 12 hours minimum notice.
- BR-SCH-9: A slot must finish by closing time, and the first free technician in preference order is the one offered, so a second technician is used only when the first is busy.
- BR-SCH-10: A time is dropped when every technician is busy; other technicians' bookings do not affect a technician's own availability.
