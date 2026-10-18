import { formatDayKey, formatTime } from "../lib/tz";
import type { Slot } from "../domain/availability/rules";

/** The free times, by day, as tap-friendly choices. Server-rendered: the choice travels as the form's "start" field. */
export function SlotPicker({ days }: { days: { day: string; slots: Slot[] }[] }) {
  return (
    <div className="flex flex-col gap-4" data-testid="slot-picker">
      {days.map((d) => (
        <fieldset key={d.day} className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">{formatDayKey(d.day)}</legend>
          <div className="flex flex-wrap gap-2">
            {d.slots.map((s) => (
              <label key={s.start.toISOString()} className="cursor-pointer rounded-md border bg-card px-3 py-2 text-sm has-[:checked]:border-teal-accent has-[:checked]:bg-muted has-[:checked]:font-semibold">
                <input type="radio" name="start" value={s.start.toISOString()} className="sr-only" required />
                {formatTime(s.start)}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
