# Rename dashboard panel "Recent activity" to "Recent activities"

**Type:** feature

The dashboard panel that lists recent activity events is titled "Recent activity". Change its visible label to "Recent activities". This is a text-only change with no behaviour, data or permission impact.

## User stories

- As a dashboard user, I want the panel titled "Recent activities" so the label reads naturally for a list of several events.

## Acceptance criteria

- **AC-1** Given a user who can see the dashboard (app/page.tsx), when the page renders, then the activity panel title reads exactly "Recent activities".
- **AC-2** Given the dashboard, when it renders, then the text "Recent activity" no longer appears as a panel title.
- **AC-3** Given the change, then the panel's contents, ordering, permissions and other dashboard panels are unchanged.

## Edge cases

- The panel is empty: the title still reads "Recent activities".
- No tests or other code reference the old label (only app/page.tsx does).

## Out of scope

- design-previews/* static HTML mockups and design-previews/README.md
- Any change to activity data, ActivityEvent model or client timeline labels
- Other dashboard labels

## Affected areas

- app/page.tsx (Panel title at line ~152)
