"use client";
import { useSyncExternalStore } from "react";
import type { Game, Scoreboard } from "@/lib/football";
import { halftimeLabel } from "@/lib/halftime";
import { halftimeClockSnapshot, halftimeServerSnapshot, subscribeHalftimeClock } from "@/lib/halftime-clock";

export function HalftimeStatus({ game, board, scopeError }: { game: Game; board: Scoreboard; scopeError: boolean }) {
  const snapshot = useSyncExternalStore(subscribeHalftimeClock, halftimeClockSnapshot, halftimeServerSnapshot);
  const label = snapshot.now ? halftimeLabel(game, board, scopeError, snapshot.now, snapshot.online, snapshot.visible) : "Halftime";
  return <span className="halftime-status">{label}</span>;
}
