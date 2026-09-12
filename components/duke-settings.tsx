"use client";
import { useState } from "react";
import { Eye, EyeOff, Settings } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { dukeHidden, isDuke, type DukeMode } from "@/lib/duke-visibility";
import type { DukeVisibility } from "@/lib/use-duke-visibility";
import type { Game } from "@/lib/football";
const modes: { value: DukeMode; label: string }[] = [{ value: "away", label: "Hide away and neutral-site games" }, { value: "hide", label: "Always hide" }, { value: "show", label: "Always show" }];
function gameDate(game: Game) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(game.date)); }
export function DukeGameControls({ games, visibility }: { games: Game[]; visibility: DukeVisibility }) {
  const { prefs, setHidden } = visibility;
  const dukeGames = [...new Map(games.filter(isDuke).map(game => [game.id, game])).values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!dukeGames.length) return null;
  return <div className="duke-controls">{dukeGames.map(game => {
    const hidden = dukeHidden(game, prefs), date = gameDate(game);
    return <div className="duke-game-control" key={game.id}>
      <AlertDialog><AlertDialogTrigger asChild><button className={`duke-toggle ${hidden ? "is-hidden" : ""}`} disabled={!prefs} aria-label={`${hidden ? "Show" : "Hide"} Duke game on ${date}`} onClick={event => { if (!hidden) { event.preventDefault(); setHidden(game.id, true); } }}>{hidden ? <EyeOff size={16} /> : <Eye size={16} />}{hidden ? "Duke hidden" : "Hide Duke"}<span>{date}</span></button></AlertDialogTrigger>
        <AlertDialogContent className="duke-reveal"><AlertDialogHeader><AlertDialogTitle>Show this game only?</AlertDialogTitle><AlertDialogDescription>Reveals the Duke matchup on {date}, including its score and status. Your default stays “{modes.find(mode => mode.value === prefs?.rules.at(-1)?.mode)?.label}.” Duke notifications stay off.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep hidden</AlertDialogCancel><AlertDialogAction onClick={() => setHidden(game.id, false)}>Show this game only</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
      {!hidden && prefs && prefs.overrides[game.id] === false && dukeHidden(game, { ...prefs, overrides: {} }) && <small>Shown for this game only</small>}
    </div>;
  })}</div>;
}
export function DukeSettings({ games, visibility }: { games: Game[]; visibility: DukeVisibility }) {
  const [open, setOpen] = useState(false);
  const mode = visibility.prefs?.rules.at(-1)?.mode ?? "away";
  return <Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><button className="icon-button" aria-label="Settings"><Settings size={21} /></button></SheetTrigger>
    <SheetContent className="settings-sheet"><SheetHeader><SheetTitle>Settings</SheetTitle><SheetDescription>Viewing preferences for this device.</SheetDescription></SheetHeader>
      <div className="settings-body"><h3>Spoiler protection</h3><DukeGameControls games={games} visibility={visibility} />
      {!games.some(isDuke) && <p>No Duke game in this date range.</p>}
      <p>Hide or show one matchup without changing your default. Hidden games stay hidden after the final whistle.</p>
      <fieldset disabled={!visibility.prefs}><legend>For future Duke games</legend>{modes.map(option => <label className="duke-mode" key={option.value}><input type="radio" name="duke-default" checked={mode === option.value} onChange={() => visibility.setMode(option.value)} />{option.label}</label>)}</fieldset>
      <p>Applies to games that haven’t started. Games already played or individually hidden or shown keep their setting.</p>
      <h3>Duke notifications</h3><p>Always off, even when you show a game.</p>
      <p className="settings-note">Each device has its own viewing preferences. Team records are omitted to avoid revealing hidden results.</p>
      {visibility.storageWarning && <p role="alert">{visibility.storageWarning}</p>}
      </div></SheetContent></Sheet>;
}
