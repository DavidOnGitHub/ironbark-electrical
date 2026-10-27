# Demo script - the AI app assistant (about 4 minutes)

A short add-on to `WALKTHROUGH.md`, best placed after the Dashboard or at the end (after the client timeline). The point to land:
**"ask your business a question in plain English and get a straight answer from your own live data - it never makes up
numbers, and it never changes anything."**

Say it once: the assistant can only *read*. Approvals, sending and editing stay with a person, which is the thread of the whole demo.

## Before you start (2 minutes)

1. **Switch it on.** It is currently hidden. In `instrumentation.ts`, delete the line `features: { appAssistant: false }` (and its comment),
   then restart `pnpm dev`. (Restart `pnpm worker` too if you changed any step code.)
2. **An AI provider must be connected** (Owner > Connected apps, an AI provider). Without one the chat opens but every question fails.
3. **Sign in as Office (`office@ironbark.test`) or the Owner.** The assistant is only offered to those two roles. The Technician and
   Bookkeeper accounts do not see it.
4. **Have data to talk about.** Best after a `pnpm demo:reset` and `pnpm workflows:seed --publish`, or right after you have run the main
   walkthrough. Ask each question once before the demo so you know the answers it will give, and so the first reply is not slow.
5. Amelia is the default character. Pick another (for example George) from the small picker in the chat header if you prefer; the choice is remembered in that browser.

## What the avatar is telling you

The character in the corner reacts, so you can narrate it: asleep after a minute of nothing, **ready** when you hover it,
**listening** when you click into the message box, **thinking** while it looks things up, and **confused** if a question fails.
(It does not do the "writing" or "celebrate" poses here - those belong to the workflow-builder assistant.)

## The script

| Min | What you do | What you say | What it should do (and the tools behind it) |
|---|---|---|---|
| 0:00 | On the **Dashboard**, hover the avatar bottom-right, then click it. Point at the message box. | "Everyone in the office asks the same questions all day: what is overdue, who is waiting on us, how are we tracking. Instead of opening five screens, they just ask." | The chat opens with the character in the header and an empty state suggesting example questions (what is overdue, what is waiting on approval). |
| 0:20 | Ask: **"What needs my attention this morning?"** | "Open question, no menu, no filters." | A short summary mixing new enquiries, approvals waiting on the office, and money overdue. *(requestCountsByStatus, listPendingTasks, receivablesSummary - several tools in one answer.)* Watch the avatar **think**. |
| 1:00 | Ask: **"Who owes us money, and how late are they?"** | "It is reading the real invoices, not a canned report. Same numbers as the Invoices page." | Overdue invoices with client, amount and days late, plus the total owing. *(receivablesSummary, listInvoices.)* Compare one figure to the **Invoices** page if you want to prove it. |
| 1:30 | Ask: **"How many enquiries did we get this week compared with last week?"** | "Questions about change over time are where spreadsheets hurt. Weeks run Monday to Sunday in Sydney time, and it knows that." | This week and last week side by side, with the percentage change. *(reportQuery with compareWithPrevious.)* |
| 2:00 | Ask: **"Which technician earned the most in the last 90 days?"** | "The owner's numbers, without opening Reports." | A ranked answer from the owner's report: revenue by technician, and optionally how fast quotes get approved. *(ownerReport.)* |
| 2:30 | Ask: **"What do we charge to install a downlight?"** then follow up: **"And do we have a bundle for a whole room?"** | "Notice I did not repeat myself - it remembers the conversation. Quoting stays consistent because everyone gets the same price list." | Price list lines and any matching bundles. *(listPriceItems, listBundles.)* The second answer builds on the first. |
| 3:00 | Pick a client from the **Clients** page and ask: **"Tell me everything about [client name] - quotes, jobs and invoices."** | "One question instead of opening four pages." | Client details, then their quotes, jobs and invoices. *(listClients, getClient, listQuotes, listJobs, listInvoices - it chains tool calls.)* |
| 3:20 | Ask: **"Are any of our automations waiting on someone?"** | "It knows the workflows too, not just the business records." | Pending approval tasks and any running or failed runs. *(listPendingTasks, listWorkflowInstances.)* |
| 3:40 | Ask: **"Send Pat a reminder about the overdue invoice."** | "Here is the important part. It will not do this." | It should say plainly that it can only answer questions and has no way to send or change anything. (Run this one in rehearsal and check the wording you get.) This is the trust moment: **it reads, a person acts.** |
| 4:00 | Open the character picker in the header and switch to another character. Close the chat. | "And it has a face your team picks. Small thing, but people actually use a tool they like." | The header and the corner avatar change; the choice persists after a refresh. |

**Close with:** "Same assistant, your data. For a clinic it would answer 'who missed an appointment this week'. We give it the right
questions to answer for your business, and it can never go beyond them."

## If something goes wrong

| What you see | What to say and do |
|---|---|
| No avatar in the corner | The flag is still off, you did not restart `pnpm dev`, or you are signed in as a Technician or Bookkeeper. Sign in as Office. |
| Every reply is an error and the avatar looks **confused** | No AI provider is connected, or its key has expired. Connect it under Connected apps. Say "the assistant needs its AI connection" and move on to the next section. |
| A reply is slow (over ten seconds) | Keep talking over it: "it is looking up several things at once". The first question after a quiet period is usually the slowest. |
| A number looks wrong | Open the matching page (Invoices, Reports) and show they agree. If they do not, say so honestly and do not argue with the screen. |
| It says it cannot answer | That is the design. "It tells you when it does not know, instead of guessing." Rephrase with a client name or a time period. |
| You ask something it has no tool for (for example how a workflow is built) | It will say so. Use the workflow builder's own assistant for that, in **Workflows** under the Automation section. |

## What it is not (say this if asked)

- It does not write, send, approve or delete anything. It is read-only on every record.
- It only sees what the signed-in person is allowed to see. The owner sees every workflow; staff only see their own.
- Conversations are saved per person (use the history picker in the header), so a question can be picked up the next day.
