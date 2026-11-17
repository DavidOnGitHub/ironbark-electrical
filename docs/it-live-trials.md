# IT assistant: live trials on staging

Three paths of the IT assistant are covered by unit tests with fakes but have never run for real. Each trial below is
written as a test case (ID, preconditions, steps, expected, cleanup, result) so that these can become the formal test set
once everything is in place. Run them on **staging** only (`https://ironbark-web.onrender.com`), as the Owner.

Fill in the **Result** line of each trial with PASS or FAIL and what you saw. A FAIL with the observed behaviour is as
useful as a PASS: that is what the trial is for.

## Before you start

| Check | How |
| --- | --- |
| `IT_AUTOFIX=on` on `ironbark-web` and `ironbark-worker` | Render, Environment. Off means errors are recorded but no fix is opened |
| `ANTHROPIC_API_KEY`, `AI_BUILDER_URL`, `AI_BUILDER_TOKEN` on both | Same place |
| `WORKFLOW_FIX_URL` (the web service's own address) and `WORKFLOW_FIX_SECRET` on **both** services, same value, and the console reachable at that address | Same place. Trial 1 needs it |
| `IT_DEMO_BREAK=on` on the web service | Trial 2 uses the demo switches |
| Worker running | Render shows `ironbark-worker` live. The failed-run watch and the revert guard run in the worker |
| AI Builder reachable | The IT assistant dock answers |

Write down the time you start each trial. The IT page's activity entries carry timestamps; compare against them.

---

## Trial 1: a workflow set up wrongly gets a proposed fix (workflow fix)

**What it proves:** a failed workflow step that is classed as a workflow-setup problem goes to the console's workflow
assistant (not AI Builder), becomes a request in "Fix prepared, waiting for review", and nothing is applied until a person
does it.

**Preconditions:** the checks above, and a published workflow in the console that you can safely break and restore
(suggested: "Quote chase" or "Review request").

**Steps**
1. In the console, open the workflow and note its current published version.
2. Edit a step so it has a required setting missing (for example, clear the recipient or subject of an email step). Publish.
3. Make the workflow run. (Suggested: do the thing that starts it, such as sending a quote for Quote chase. If you cannot
   start it by hand, note that: it is a gap in the trial and worth fixing.)
4. Wait for the step to fail (up to a few minutes). The error should name a missing or required setting.
5. Open Ironbark, IT, "Bug fixes".

**Expected**
- The error is recorded once (count 1, not 2) with the source "step".
- It is classed "Workflow setup", and a request appears in the state "Fix prepared, waiting for review" (not "Building").
- No AI Builder session or pull request is created for it.
- In the console's workflow assistant, a card shows the proposed change with **Apply to canvas** and **Dismiss**.
- The workflow itself is unchanged until you apply it.

**Then** press **Apply to canvas**, review the change, publish. Back in Ironbark the request should move to "Fix applied -
publish the workflow to make it live". Run the workflow again: it should now succeed.

**Also check:** repeat step 2 to 4, then press **Dismiss** instead. The request should close without changes.

**Cleanup:** restore the workflow's original version and publish. Close any request left open.

**Record:** time of failure, time the proposal appeared, the proposal's wording (is it plain and correct?), Result.

---

## Trial 2: errors rise after a change goes live (revert guard)

**What it proves:** 30 minutes after a change goes live, a clear rise in errors is noticed and a revert request is
prepared, which a person must accept. It never reverts by itself.

**Preconditions:** the checks above. Keep the demo switches on the IT page off to begin with.

**Steps**
1. Ask the IT assistant for a harmless change (for example "change the label X on page Y"). Approve the plan, accept the
   preview, and wait until the request reads **Live**. Note the time it went Live: this is the start of the 30 minutes.
2. Within the next 10 minutes, switch **on** both demo bugs on the IT page.
3. Load `/quotes` and `/jobs` at least 6 times in total (each load throws the error). Spread them out a little.
4. Switch both demo bugs **off** again (so real users are not affected) and leave the app alone.
5. 30 to 35 minutes after the change went Live, open the change's request on the IT page and read its history.

**Expected**
- An entry like "errors rose after going live" with the numbers (for example "6 errors in the 30 minutes after it went
  live, against 0 in the 30 minutes before").
- A new request "Undo IT-xxxx: errors rose after it went live" that waits for a person to accept it. It is a normal
  request: nothing is merged until you accept it.
- The original change is **not** reverted by itself.

**Also check (no spike):** repeat with a harmless change but do not touch the demo switches. 30 minutes after Live the
history should say "no rise in errors" and no revert request should exist.

**Also check (no loop):** accept nothing of the revert request. Confirm the revert request itself never gets its own
revert check or a further revert request.

**Cleanup:** close the revert request and any fix requests the demo errors opened (IT_AUTOFIX opens fixes for them).
Confirm both demo switches are off.

**Record:** time Live, error counts, whether the revert request appeared and when, Result.

---

## Trial 3: a run that fails without a step reporting why (failed-run watch)

**What it proves:** the worker notices a failed workflow run that no step explained, records it once, and ignores runs
that were stopped on purpose.

**Preconditions:** the checks above, and access to the Temporal web UI for the staging namespace.

**Steps (3a, stopped on purpose)**
1. Start a workflow run that waits (for example one with a wait or delay step), so it stays running for a while.
2. In the Temporal UI, **terminate** that run.
3. Wait two minutes, then open Ironbark, IT, "Bug fixes".

**Expected (3a):** the run is marked failed or cancelled in the console, but **no** error is recorded for it in Ironbark,
because a terminated run is a person's decision and not a bug.

**Steps (3b, failed on its own)**
1. Find a way to make a run fail without a step throwing: a workflow timeout shorter than the run needs is the simplest.
   Set a very short workflow run timeout on a test workflow, or start a run that cannot finish in time.
2. Let it time out. Wait two minutes.

**Expected (3b):** one error appears on the IT page with the source "workflow" and a message about the timeout. It is
recorded **once**, not once per minute.

**Also check:** read the worker log around the time and confirm there are no repeated "failed-run check failed" lines.

**Cleanup:** remove the test workflow or its short timeout. Close any request opened for the error.

**Record:** what you did to cause 3b (there may be a better way; write it down), the worker log lines, Result.

---

## After the trials

For each FAIL, write down the observed behaviour and the time, and send it back. Each trial that passes becomes an
automated or scripted test case; each fail becomes a bug to fix first.

| Trial | Date | Result | Notes |
| --- | --- | --- | --- |
| 1 Workflow fix, apply | | | |
| 1 Workflow fix, dismiss | | | |
| 2 Revert guard, spike | | | |
| 2 Revert guard, no spike | | | |
| 2 Revert guard, no loop | | | |
| 3a Terminated run ignored | | | |
| 3b Timed-out run recorded once | | | |
