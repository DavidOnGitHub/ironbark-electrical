# Ironbark Electrical - design previews

Three visual themes for the Ironbark demo app. Each is a set of standalone HTML files (inline CSS, a few lines of inline JS for the preview switches, Google Fonts only). Open `index.html` to compare them.

```
design-previews/
  index.html                 the three themes side by side, with the reasons for each
  harbour/      dashboard.html  invoices.html  my-day.html
  ironbark/     dashboard.html  invoices.html  my-day.html
  switchboard/  dashboard.html  invoices.html  my-day.html
```

- `dashboard.html` - desktop owner view: sidebar, 4 KPI tiles, ready-to-invoice notice, waiting for a first reply, overdue invoices, on the tools today, recent activity.
- `invoices.html` - desktop invoice list: summary tiles, jobs ready to invoice, status filter with counts, search, table. A preview bar (bottom right, not part of the app) switches the table between **Data / Loading / Empty / Error**.
- `my-day.html` - technician phone view at 390px: current job, next job, later and tomorrow, Call / Directions, big status buttons, note or variation form. The preview bar switches **Online / Offline**.

All pages respond down to 390px. The sidebar becomes a drawer under 1024px and the invoice table becomes a stack of cards under 720px. The moon button switches light and dark (in the previews it is stored per theme in localStorage).

**Recommendation: Ironbark.** Harbour is a good neutral default for the M-Street kit itself.

---

## 1. Design tokens per theme

Every theme uses the same token names. The values are below. Text pairs were checked against WCAG 2.1 AA, and all pass 4.5:1: ink on bg, muted on surface, link, primary text on primary, sidebar text, and each status colour on its soft background.

### Harbour - calm, light, corporate

| Token | Light | Dark |
|---|---|---|
| bg | `#F3F5F7` | `#0F1722` |
| surface / surface-2 | `#FFFFFF` / `#F7F9FB` | `#16212F` / `#1B2838` |
| ink / muted | `#15212E` / `#526070` | `#E7EDF4` / `#A3B0BE` |
| border / border-strong | `#DDE3E9` / `#C3CDD7` | `#273548` / `#36485E` |
| primary / on-primary | `#1D4F84` / `#FFFFFF` | `#7EB3EC` / `#0B1A2B` |
| primary-soft (hover, active nav) | `#E8F0F8` | `#1B3150` |
| sidebar bg / ink | `#FFFFFF` / `#26323F` | `#121B27` / `#D5DEE8` |
| ok / warn / bad | `#17663F` / `#8A4B00` / `#A8201A` | `#7FD3A4` / `#F2C077` / `#FF9B92` |
| info / progress / neutral | `#1D4F84` / `#5140A6` / `#4A5563` | `#8DBCEE` / `#B8AEF5` / `#B6C1CD` |

- Type: Public Sans 400/500/600/700. Headings 700, tracking -0.015em.
- Radius: cards 10px, controls 8px, small 6px, chips are pills.
- Shadow: `0 1px 2px rgba(21,33,46,.06)` on panels only. None in dark mode.
- Signature: the KPIs share one ruled panel (1px gaps over the border colour). The active nav item has a 3px left bar.

### Ironbark - warm, made for the trade (recommended)

| Token | Light | Dark |
|---|---|---|
| bg | `#ECEEE9` (gum-leaf mist) | `#191513` |
| surface / surface-2 | `#FFFFFF` / `#F5F6F2` | `#231E1B` / `#2A2421` |
| ink / muted | `#1F1A17` / `#5A564F` | `#F2EDE7` / `#BAB1A7` |
| border / border-strong | `#D8DAD2` / `#BFC2B7` | `#3A322D` / `#4D433C` |
| primary / on-primary | `#2B2420` bark / `#FFFFFF` | `#F6B800` hi-vis / `#1F1A17` |
| hi-vis accent | `#F6B800`, always with `#1F1A17` text | same |
| link | `#2C5E43` eucalypt | `#95C8A6` |
| sidebar bg / ink | `#2B2420` / `#ECE6DF` | `#120F0D` / `#E6DFD7` |
| ok / warn / bad | `#2C6A3E` / `#7F4C08` / `#A3261B` | `#8ED3A0` / `#F6C55A` / `#FF9A8C` |
| info / progress / neutral | `#2B5880` / `#683D8C` / `#55504A` | `#93C0EA` / `#CDA6EC` / `#C9C1B7` |

- Type: Barlow Condensed 700 for headings, KPI numbers and job tags. Barlow 400/500/600 for body text. Page title 34px.
- Radius: cards 6px, controls 4px, tags 2px. Small radii suit the sturdy, workshop feel.
- Shadow: a 1px hairline (`0 1px 0 rgba(31,26,23,.08)`) only.
- Signature: hi-vis job tags (J-2012) that look like cable labels. Hi-vis also marks the active nav item, the nav counts, KPI tiles that need action (4px top rule) and the current job on My day (6px left rule). Focus is a 3px dark ring with a hi-vis halo, so it is visible on every background.
- Rule: hi-vis is never used for text on white (it fails contrast). It is only a fill behind dark text, or a rule.

### Switchboard - dark first, modern

| Token | Dark (default) | Light |
|---|---|---|
| bg | `#0D1520` | `#F1F4F8` |
| surface / surface-2 | `#142131` / `#1A293C` | `#FFFFFF` / `#F6F8FB` |
| ink / muted | `#E6EDF5` / `#9AA9BB` | `#0F1B2A` / `#4D5D70` |
| border / border-strong | `#22334A` / `#30475F` | `#DCE3EC` / `#C4CFDC` |
| primary / on-primary | `#5CB2FF` / `#04121F` | `#0A66C2` / `#FFFFFF` |
| sidebar bg / ink | `#0A111A` / `#C9D4E1` | `#0F1B2A` / `#D3DDE8` (stays dark) |
| ok / warn / bad | `#4FD8A4` / `#F5BD4F` / `#FF8B7E` | `#0F6E49` / `#875000` / `#B42318` |
| info / progress / neutral | `#6CBBFF` / `#B9A4FF` / `#A9B6C6` | `#0A5FB4` / `#5A3EC2` / `#4D5D70` |

- Type: Onest 400/500/600/700. Headings 650, tracking -0.02em. Numbers at -0.03em.
- Radius: cards 14px, controls 10px, small 8px, chips are pills.
- Shadow: a faint inset top highlight on panels. `0 10px 30px rgba(0,0,0,.35)` for overlays.
- Signature: status dots glow like indicator lights, and each KPI tile has an indicator light in its tone.

### Shared scale (all themes)

- Type sizes (px): 12.5 chips and counts / 13.5 meta / 14.5 nav and buttons / 15 body / 17 panel titles / 21 job titles / 28 page titles (Ironbark 34) / 34-44 KPI numbers (26 on phones).
- Spacing: a 4px base. Panels have 14-18px padding and 20px gaps. Page padding is 30/36px on desktop and 20/16px on phones.
- Cents shown at 62% size (`$21,846.30` with a small `.30`), so whole dollars read first. Every number uses `tabular-nums`, and money is right-aligned in tables.

---

## 2. UX improvements common to all three

**Navigation**
- Sections are named for the work: Customers (Clients, Requests), Work (Quotes, Jobs, Schedule, Invoices), Insights, Setup. "Workflows" becomes "Automations" for non-technical staff.
- Counts in the nav show what needs action: Requests 4 new, Schedule 3 to schedule, Invoices 3 overdue in red. Each count has screen-reader text ("4 new enquiries").
- Search is always in the sidebar, with `/` as the shortcut.
- Under 1024px the sidebar is a drawer with a 56px top bar and a 44px menu button. Esc or tapping the scrim closes it.
- Technicians land on My day, a phone screen with no sidebar.

**Hierarchy**
- The dashboard has 4 KPI tiles instead of 9 tiles of equal weight. Every tile links somewhere and has a sub-line that says what to do ("Oldest waiting 26 h", "$6,284.00 overdue").
- One notice for the money that is ready to collect ("2 completed jobs are ready to invoice"), with a single action.
- Lists sort by what needs attention first. Enquiries go urgency then age, and any wait over 24 h is shown bold in the warn colour. Overdue invoices show the next chase step, not just the days.
- New: "On the tools today", so the office can see who is where without opening Schedule.
- My day is built around Now / Next / Later / Tomorrow. Only the current job is fully expanded. A job gets one primary button: Mark complete when it is in progress. Start job stays secondary while another job is still running.

**Status chips**
- The current 7 hues come down to 6 meanings: ok, warn, bad, info, progress, neutral. Each chip is a dot plus words, so colour is never the only signal. Overdue chips include the days ("Overdue 18 days"), and Void is struck through.
- Mapping: Draft = neutral, Sent / Scheduled = info, Part paid / In progress = progress, Paid / Completed / Won = ok, Urgent / Unscheduled / Expired = warn, Overdue / Emergency / Declined / Lost = bad.

**Empty, loading, error and offline**
- Loading: skeleton rows that match the table, so the layout does not jump. The shimmer stops under `prefers-reduced-motion`. There is `aria-busy` on the container and a hidden "Loading invoices" label.
- Empty: says why it is empty and offers the next step ("No overdue invoices. Every invoice is paid or still inside its payment terms." plus "Show all invoices").
- Error: says what happened, that nothing was changed, and gives a Try again button. It uses `role="alert"` and never blames the user.
- Offline (My day): a warn banner says work continues and changes send automatically, and the "All changes saved" line changes to match. This needs a small offline queue for status changes and notes when it is built.
- Confirmation: Mark complete shows a toast that uses the same words ("J-2012 marked complete").

**Accessibility and touch**
- AA contrast on every text pair (see section 1). Focus is a 2px ring in the theme's focus colour (Ironbark adds a halo). There is a skip link on every page.
- Touch targets on phones: Call and Directions are 48px, status buttons 56px, form fields 48px with 16px text (so iOS does not zoom), nav rows 38px on desktop and 44px icon buttons on touch. These extend the `pointer: coarse` rules already in `app/globals.css`.
- Real `<table>` markup with `scope="col"` on desktop. On phones the rows are restyled as cards, without duplicating any markup.
- Landmarks: `aside` labelled Main, `nav` labelled Sections, `main#main`, and every panel labelled by its heading.
- Hover only ever adds to an action. Nothing depends on it.

---

## 3. How to implement this in the existing setup

The app imports `@kabosh-digital/m-street-kit/styles.css`. That file defines shadcn-style tokens on `:root` and `.dark` (`--background`, `--card`, `--primary`, `--muted-foreground`, `--radius`, `--teal-accent` and so on), and Tailwind reads them through `@theme inline`. A theme is therefore mostly a block of overrides placed after the import in `app/globals.css`. The rules are unlayered and come later, so they win.

### 3.1 Token mapping

| Preview token | Kit / shadcn variable |
|---|---|
| bg | `--background` |
| surface | `--card`, `--popover` |
| surface-2 | `--muted`, `--secondary` |
| ink | `--foreground`, `--card-foreground`, `--popover-foreground`, `--secondary-foreground` |
| muted | `--muted-foreground` |
| border / border-strong | `--border` / `--input` |
| primary / on-primary | `--teal-accent` / `--teal-accent-foreground` (these feed `--primary`, `--ring` and the sidebar's active state) |
| primary-soft | `--accent`, with `--accent-foreground` set to ink |
| bad | `--destructive` |
| ok / warn / bad / info / progress | `--status-completed` / `--status-pending` / `--status-failed` / `--status-running`, plus new `--status-progress` |
| sidebar-* | `--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-border` |
| r-lg | `--radius` (the kit derives sm/md/xl from it) |

Example for Ironbark (Harbour and Switchboard follow the same pattern with the values from section 1):

```css
@import "@kabosh-digital/m-street-kit/styles.css";

:root {
  --background: #ECEEE9;  --foreground: #1F1A17;
  --card: #FFFFFF;        --card-foreground: #1F1A17;
  --popover: #FFFFFF;     --popover-foreground: #1F1A17;
  --muted: #F5F6F2;       --muted-foreground: #5A564F;
  --secondary: #F5F6F2;   --secondary-foreground: #1F1A17;
  --accent: #F1EFEA;      --accent-foreground: #1F1A17;
  --border: #D8DAD2;      --input: #BFC2B7;
  --destructive: #A3261B;
  --teal-accent: #2B2420; --teal-accent-foreground: #FFFFFF;   /* primary = bark */
  --sidebar: #2B2420;     --sidebar-foreground: #ECE6DF;
  --sidebar-accent: #40362F; --sidebar-border: #40362F;
  --radius: 0.375rem;
  --hivis: #F6B800;       --hivis-foreground: #1F1A17;
  --status-ok: #2C6A3E;   --status-ok-soft: #E3EFE4;
  --status-warn: #7F4C08; --status-warn-soft: #FBEED0;
  --status-bad: #A3261B;  --status-bad-soft: #F8E4E0;
  --status-info: #2B5880; --status-info-soft: #E4EDF5;
  --status-prog: #683D8C; --status-prog-soft: #F0E8F6;
  --status-neutral: #55504A; --status-neutral-soft: #EEEDE8;
}
.dark {
  --background: #191513;  --foreground: #F2EDE7;
  --card: #231E1B;        --muted: #2A2421;  --muted-foreground: #BAB1A7;
  --border: #3A322D;      --input: #4D433C;
  --teal-accent: #F6B800; --teal-accent-foreground: #1F1A17;   /* primary = hi-vis in dark */
  --sidebar: #120F0D;     --sidebar-foreground: #E6DFD7;
  /* ...status pairs from the dark column */
}
@theme inline {
  --color-hivis: var(--hivis);
  --color-hivis-foreground: var(--hivis-foreground);
  --color-status-ok: var(--status-ok); --color-status-ok-soft: var(--status-ok-soft);
  /* ...one line per status token, so classes like bg-status-ok-soft text-status-ok exist */
}
```

### 3.2 Changes outside the token block

1. **Sidebar colours (kit change).** `Sidebar.tsx` uses `bg-card` and `text-teal-accent`, not the `--sidebar*` tokens. Harbour works with it as it is. Ironbark and Switchboard need the sidebar to switch to `bg-sidebar text-sidebar-foreground` and `hover:bg-sidebar-accent`, with an active item of `bg-sidebar-accent` plus a 3px inset bar in `--sidebar-primary`. The mobile top bar needs the same change. The section headings should move from `uppercase tracking-widest` to sentence case at 12.5px semibold, as in the previews.
2. **Fonts (kit option).** `KitRootLayout` loads Inter through `next/font` as `--font-inter`. Add a `fonts` option to the kit config, or override in `app/globals.css`: `body { font-family: "Barlow", system-ui, sans-serif }` plus `--font-heading`. Load Barlow and Barlow Condensed (or Public Sans, or Onest) with `next/font/google` in `app/layout.tsx`. Headings then use `font-heading`.
3. **Root size.** The kit sets `html { font-size: 18px }`. The previews are drawn at a 16px root with 15px body text. Either keep 18px and read the pixel sizes above as relative (multiply by 18/16), or bring the root down to 16px together with this redesign. The larger root is the main reason the current app feels oversized and loose.
4. **Chips (`src/ui/chips.tsx`).** Swap the per-status Tailwind colour strings for the six semantic classes (`bg-status-ok-soft text-status-ok` and so on), add the leading dot (`before:size-[7px] before:rounded-full before:bg-current`), and show the overdue days inside the chip. All chips (request, urgency, quote, job, invoice) then share one `STATUS_TONE` map.
5. **StatTile (kit).** Add a `variant` per theme: `ledger` (Harbour: a grid with `gap-px bg-border`), `rule` (Ironbark: `border-t-4` coloured by tone, `font-heading` value), or `led` (Switchboard: an indicator dot in the corner). Render cents with a `<span class="text-[0.62em]">`, using a `formatMoneyParts` helper next to `formatMoney`.
6. **Job tags.** A new `JobTag` component: `bg-hivis text-hivis-foreground font-heading` in Ironbark, `bg-muted` in the other two.
7. **My day.** Reorder into Now / Next / Later / Tomorrow. Make tap buttons `h-12`/`h-14` on every screen, not just under `sm:`. Collapse jobs that are not current into a single-line link. Show only one primary action per screen.
8. **States.** Add a `TableSkeleton`, an `EmptyState` (icon, title, one sentence, one action) and an `ErrorState` (`role="alert"`, Try again) to `src/ui`, and use them in every list page, including `loading.tsx` and `error.tsx` route files.
