# Rename dashboard panel label to "Latest activities"

**Type:** feature

The dashboard's activity panel is currently titled "Recent activity" (the request calls it "Recent activities"). Change the visible title to "Latest activities". Label text only; no behaviour, data or permission changes.

## User stories

- As a dashboard user, I want the activity panel titled "Latest activities" so the wording matches what the business prefers.

## Acceptance criteria

- **AC-1** Given a signed-in user who can see the dashboard at /, when the page renders, then the activity panel heading reads "Latest activities".
- **AC-2** Given the dashboard renders, then the text "Recent activity" no longer appears as a panel heading on the page.
- **AC-3** Given there are no activity events, then the panel still shows the empty message "No activity yet." under the new heading.
- **AC-4** Given the label change, then the activity list contents, order, row layout and the roles that can see the panel are unchanged.

## Edge cases

- No existing tests reference the old label, so no test updates are expected.

## Out of scope

- design-previews/*/dashboard.html static mockups
- design-previews/README.md wording
- Changing the empty-state text or any other dashboard labels
- Any change to which activities are shown or how many

## Affected areas

- app/page.tsx (Panel title at line ~152)
