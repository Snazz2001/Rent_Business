import { describe, it, expect } from "vitest";
import { buildCalendarGrid, dateRange } from "../calendarGrid";

describe("dateRange", () => {
  it("produces N consecutive ISO dates starting from the given date", () => {
    const days = dateRange(new Date(2026, 7, 1), 5); // August 1, 2026 (local)
    expect(days).toEqual(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]);
  });
});

describe("buildCalendarGrid", () => {
  const days = dateRange(new Date(2026, 7, 1), 7); // 2026-08-01 .. 2026-08-07

  it("marks every cell free when there are no bookings", () => {
    const grid = buildCalendarGrid(["p1"], days, []);
    for (const day of days) expect(grid.p1[day].state).toBe("free");
  });

  it("marks the check-in date as occupied and the check-out date as free", () => {
    const grid = buildCalendarGrid(["p1"], days, [
      { propertyId: "p1", checkIn: "2026-08-02", checkOut: "2026-08-04", status: "confirmed" },
    ]);
    expect(grid.p1["2026-08-01"].state).toBe("free");
    expect(grid.p1["2026-08-02"].state).toBe("occupied");
    expect(grid.p1["2026-08-03"].state).toBe("occupied");
    expect(grid.p1["2026-08-04"].state).toBe("free"); // checkout day is free — back-to-back bookings work
  });

  it("marks tentative bookings distinctly from confirmed ones", () => {
    const grid = buildCalendarGrid(["p1"], days, [
      { propertyId: "p1", checkIn: "2026-08-02", checkOut: "2026-08-04", status: "tentative" },
    ]);
    expect(grid.p1["2026-08-02"].state).toBe("tentative");
  });

  it("ignores non-occupying statuses (enquiry, cancelled, no_show)", () => {
    const grid = buildCalendarGrid(["p1"], days, [
      { propertyId: "p1", checkIn: "2026-08-02", checkOut: "2026-08-04", status: "enquiry" },
      { propertyId: "p1", checkIn: "2026-08-02", checkOut: "2026-08-04", status: "cancelled" },
    ]);
    expect(grid.p1["2026-08-02"].state).toBe("free");
  });

  it("keeps properties independent of one another", () => {
    const grid = buildCalendarGrid(["p1", "p2"], days, [
      { propertyId: "p1", checkIn: "2026-08-02", checkOut: "2026-08-04", status: "confirmed" },
    ]);
    expect(grid.p1["2026-08-02"].state).toBe("occupied");
    expect(grid.p2["2026-08-02"].state).toBe("free");
  });

  it("lets a confirmed booking override an overlapping tentative one when both are present in the input", () => {
    const grid = buildCalendarGrid(["p1"], days, [
      { propertyId: "p1", checkIn: "2026-08-02", checkOut: "2026-08-05", status: "tentative" },
      { propertyId: "p1", checkIn: "2026-08-03", checkOut: "2026-08-04", status: "confirmed" },
    ]);
    expect(grid.p1["2026-08-02"].state).toBe("tentative");
    expect(grid.p1["2026-08-03"].state).toBe("occupied");
    expect(grid.p1["2026-08-04"].state).toBe("tentative");
  });

  it("ignores bookings for properties not in the requested list", () => {
    const grid = buildCalendarGrid(["p1"], days, [
      { propertyId: "unknown-property", checkIn: "2026-08-02", checkOut: "2026-08-04", status: "confirmed" },
    ]);
    expect(grid.p1["2026-08-02"].state).toBe("free");
  });
});
