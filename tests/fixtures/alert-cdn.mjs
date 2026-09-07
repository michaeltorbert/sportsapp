// Defaults reproduce issue #18's season-opening calendar, not a typical seven-day week.
// Its selected-week envelope fully covers the September 4–5 alert window.
export function alertCdn(events = [], { startDate = "2026-08-22T07:00Z", endDate = "2026-09-08T06:59Z" } = {}) {
  return { content: { sbData: {
    season: { type: 2 }, week: { number: 1 },
    leagues: [{ calendar: [{ value: "2", entries: [{ value: "1", startDate, endDate }] }] }],
    events,
  } } };
}
