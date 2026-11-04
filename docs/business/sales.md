# Sales: clients, enquiries, price list and quotes

Money is integer cents everywhere; line amounts are ex GST. Business time is Sydney time.
Rules marked "(inferred)" come from the code only and are not confirmed by a test or doc.

## Clients (CLI)

- BR-CLI-1: A client needs a name (1-200 characters); email, if given, must be a valid address; type is PERSON or COMPANY (default PERSON) and preferred contact is EMAIL or PHONE (default EMAIL).
- BR-CLI-2: A client has at most 12 tags, each 1-40 characters; tags typed as comma-separated text are trimmed, lower-cased and de-duplicated.
- BR-CLI-3: A site needs a street address, a suburb and a 4-digit postcode; state defaults to NSW.
- BR-CLI-4: Emails are matched case-insensitively after trimming, and a blank email has no match key.
- BR-CLI-5: Phone numbers are matched by digits only, with Australian formats brought to the national form (`+61 412 345 678`, `0061...` and `0412 345 678` are the same number), and a number with fewer than 8 digits after dropping the trunk prefix has no match key.
- BR-CLI-6: Two clients look like duplicates when their normalised email or their normalised phone match; a missing value never matches.
- BR-CLI-7: Archived clients are ignored when looking for duplicates, and the client itself is never reported as its own duplicate.
- BR-CLI-8: Every change to a client, site or note writes an activity event to the client timeline in the same transaction (convention in README; applies to all modules).

## Enquiries (REQ)

- BR-REQ-1: An enquiry moves only along these steps: NEW to CONTACTED, SITE_VISIT_BOOKED, QUOTED or LOST; CONTACTED to SITE_VISIT_BOOKED, QUOTED or LOST; SITE_VISIT_BOOKED to CONTACTED, QUOTED or LOST; QUOTED to CONTACTED, WON or LOST; LOST to NEW; WON is final.
- BR-REQ-2: An enquiry cannot skip straight to WON from before QUOTED, and cannot move to its own status.
- BR-REQ-3: WON and LOST are closed; every other status is open work.
- BR-REQ-4: A lost reason is stored only when moving to LOST and is cleared when the enquiry is reopened.
- BR-REQ-5: Creating a client from an enquiry is refused when the enquiry is already linked to a client.
- BR-REQ-6: A client created from an enquiry is named after the contact name (or the contact email, or "New client"), prefers EMAIL when an email exists and PHONE otherwise.
- BR-REQ-7: Contact details a customer gives on the booking page fill only blank fields on the enquiry and never overwrite details already recorded.
- BR-REQ-8: Existing clients are suggested as duplicate hints only for an enquiry that is not yet linked to a client.
- BR-REQ-9: An enquiry's age is the hours since it was received, never negative, shown as minutes under 1 hour, hours under 48 hours, otherwise days.

## Price list and bundles (PRC)

- BR-PRC-1: A price item has a kind (LABOUR, CALL_OUT, STANDARD_JOB or MATERIAL), a name of 1-120 characters, a unit (default "each") and a price of 0 to $100,000.00 ex GST.
- BR-PRC-2: A material with both a cost and a markup percentage (0-500, whole numbers) has its sell price derived as cost x (1 + markup/100), rounded half up; any other item requires an explicit price.
- BR-PRC-3: Cost and markup are kept only for MATERIAL items.
- BR-PRC-4: A price item is retired (made inactive) rather than deleted, and can be reactivated (inferred: no delete function exists).
- BR-PRC-5: A bundle needs a unique name (1-120 characters) and at least one item, each with a quantity greater than zero and at most 10,000; a bundle has no price of its own.
- BR-PRC-6: Adding a bundle to a quote uses each item's current name, unit and price, and skips retired items.
- BR-PRC-7: Quote suggestions may only choose price-list entries and quantities, never a price; with an AI key set the AI is used, and keyword matching is the fallback if the call fails.
- BR-PRC-8: Technicians never see prices (inferred from the access table: pricing is limited to Owner and Office).

## Quotes (QUO)

- BR-QUO-1: A quote needs a client and a title of 1-200 characters, and starts as DRAFT valid for 14 days.
- BR-QUO-2: A quote line needs a description (1-300 characters), a quantity above zero and at most 10,000, a unit (default "each") and a unit price of 0 to $100,000.00; a quote has at most 60 lines.
- BR-QUO-3: Each line total is quantity x unit price rounded half up to the cent.
- BR-QUO-4: GST is 10% of the subtotal (not summed per line), rounded half up, and the total is subtotal plus GST.
- BR-QUO-5: A deposit is required only when the total including GST is over $1,500.00 (150,000 cents), and is then 30% of that total rounded half up.
- BR-QUO-6: Only a DRAFT quote's lines can be edited.
- BR-QUO-7: Only a DRAFT quote can be sent, and it needs at least one line and a total above zero; sending stamps the sent time, restarts validity at 14 days from now and moves the linked enquiry to QUOTED when the pipeline allows.
- BR-QUO-8: A SENT quote past its valid-until date reads as EXPIRED without any stored change; other statuses are unaffected.
- BR-QUO-9: Only a SENT, not expired quote can be approved or declined; an expired quote must have its validity extended first.
- BR-QUO-10: Approving a quote creates the job in the same transaction and moves the linked enquiry to WON when the pipeline allows; declining creates no job.
- BR-QUO-11: A pipeline failure when syncing the enquiry never undoes the quote action.
- BR-QUO-12: Only a SENT quote's validity can be extended, by a whole number of 1 to 60 days counted from now.
- BR-QUO-13: A quote's customer link token is created only for a quote that is not a DRAFT, is unique, and is at least 16 characters; an unknown token or a draft shows nothing.
- BR-QUO-14: A customer's answer through the link follows the same rules and has the same effects as the office recording it, with the reason truncated to 1,000 characters.
- BR-QUO-15: Numbers are sequential: quotes Q-1001 upward.
- BR-QUO-16: The estimated job duration is the sum of hours on lines whose unit is "hour", kept between 60 and 480 minutes, and 180 minutes when there are no labour hours.
