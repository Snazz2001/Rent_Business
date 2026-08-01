/**
 * Pure grid-building logic for the multi-property calendar view (spec
 * 4.4). Kept separate from the page component so it's directly
 * unit-testable without rendering React or touching the database.
 */

export interface CalendarBookingInput {
  propertyId: string;
  checkIn: string; // ISO date
  checkOut: string; // ISO date, exclusive
  status: string;
}

export type CellState = "free" | "occupied" | "tentative";

export interface CalendarCell {
  state: CellState;
}

/** Formats a Date as YYYY-MM-DD using its local calendar fields. Exported
 * because this pitfall (toISOString() silently shifting the date near
 * midnight in any timezone ahead of UTC — this project runs in
 * Asia/Dubai, UTC+4) is easy to reintroduce; tests reuse this helper too
 * rather than each rolling their own via toISOString(). */
export function toIsoDateLocal(d: Date): string {
  // Deliberately not toISOString(): that converts through UTC and shifts
  // the date by a day for any timezone not exactly at UTC+0 (this project
  // runs in Asia/Dubai, UTC+4 — toISOString() rolled every date back by
  // one). Format from local calendar fields instead.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `count` consecutive ISO dates starting from `start` (inclusive). */
export function dateRange(start: Date, count: number): string[] {
  const out: string[] = [];
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let i = 0; i < count; i++) {
    out.push(toIsoDateLocal(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const OCCUPYING = new Set(["confirmed", "checked_in"]);
const TENTATIVE = new Set(["tentative"]);

/** Builds propertyId -> date -> cell state, for every property in
 * `propertyIds` and every date in `days`. A booking occupies a cell for
 * dates in [checkIn, checkOut) — checkout day itself is free (matches the
 * '[)' range semantics of the database exclusion constraint). */
export function buildCalendarGrid(
  propertyIds: string[],
  days: string[],
  bookings: CalendarBookingInput[]
): Record<string, Record<string, CalendarCell>> {
  const grid: Record<string, Record<string, CalendarCell>> = {};
  for (const pid of propertyIds) {
    grid[pid] = {};
    for (const day of days) grid[pid][day] = { state: "free" };
  }

  for (const b of bookings) {
    if (!grid[b.propertyId]) continue;
    const state: CellState | null = OCCUPYING.has(b.status) ? "occupied" : TENTATIVE.has(b.status) ? "tentative" : null;
    if (!state) continue;
    for (const day of days) {
      if (day >= b.checkIn && day < b.checkOut) {
        const existing = grid[b.propertyId][day];
        // occupied always wins over tentative if both happen to be present
        if (!existing || existing.state === "free" || (existing.state === "tentative" && state === "occupied")) {
          grid[b.propertyId][day] = { state };
        }
      }
    }
  }

  return grid;
}
