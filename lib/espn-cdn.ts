import { z } from "zod";
import { easternDate } from "./football";
import { normalizeCdnRange, scoreboardCdnUrl } from "./espn-data";

const entry = z.object({ value: z.string().regex(/^\d+$/), startDate: z.string().datetime({ offset: true }), endDate: z.string().datetime({ offset: true }) });
const metadata = z.object({ content: z.object({ sbData: z.object({
  season: z.object({ year: z.number().int(), type: z.number().int() }), week: z.object({ number: z.number().int() }),
  leagues: z.array(z.object({ calendar: z.array(z.object({ value: z.string(), entries: z.array(entry) })) })), events: z.array(z.unknown()),
}) }) });

// A single selected week cannot prove an entire boundary day. Fetch all
// intersecting weeks and accept only an identity-checked, continuous union.
export async function completeCdnRange(raw: unknown, date: string, endDate = date, accOnly = false, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  try { return normalizeCdnRange(raw, date, endDate, accOnly); } catch { /* Require stronger coverage evidence below. */ }
  const initial = metadata.safeParse(raw);
  if (!initial.success) return normalizeCdnRange(raw, date, endDate, accOnly);
  const first = initial.data.content.sbData;
  const weeks = first.leagues[0]?.calendar.find(period => period.value === String(first.season.type))?.entries
    .filter(week => easternDate(new Date(week.startDate)) <= endDate && easternDate(new Date(week.endDate)) >= date)
    .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate)) || [];
  if (!weeks.length || weeks.length > 3 || date <= easternDate(new Date(weeks[0].startDate)) || endDate >= easternDate(new Date(weeks.at(-1)!.endDate)))
    throw new Error("CDN does not cover the requested dates");
  for (let i = 1; i < weeks.length; i++) {
    // ESPN calendar end dates name the final inclusive minute (06:59Z).
    if (Date.parse(weeks[i].startDate) !== Date.parse(weeks[i - 1].endDate) + 60000)
      throw new Error("CDN does not cover the requested dates continuously");
  }
  const events: unknown[] = [];
  for (const week of weeks) {
    let current = first;
    if (String(first.week.number) !== week.value) {
      const url = new URL(scoreboardCdnUrl());
      url.searchParams.set("year", String(first.season.year));
      url.searchParams.set("seasontype", String(first.season.type));
      url.searchParams.set("week", week.value);
      const response = await fetcher(url, { headers: { Accept: "application/json" }, signal });
      if (!response.ok) throw new Error(`ESPN CDN status ${response.status}`);
      current = metadata.parse(await response.json()).content.sbData;
    }
    const actual = current.leagues[0]?.calendar.find(period => period.value === String(current.season.type))?.entries.find(item => item.value === week.value);
    if (current.season.year !== first.season.year || current.season.type !== first.season.type || String(current.week.number) !== week.value || actual?.startDate !== week.startDate || actual?.endDate !== week.endDate)
      throw new Error("CDN returned a different requested week");
    events.push(...current.events);
  }
  return normalizeCdnRange({ content: { sbData: { ...first, events, week: { number: 1 }, leagues: [{ calendar: [{ value: String(first.season.type), entries: [{ value: "1", startDate: weeks[0].startDate, endDate: weeks.at(-1)!.endDate }] }] }] } } }, date, endDate, accOnly);
}
