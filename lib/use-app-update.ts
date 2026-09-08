"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { refreshUrl, type UpdateView } from "./app-update";
import { createAppUpdater, type UpdateState } from "./app-update-controller";
export const LOADED_COMMIT = process.env.SOURCE_COMMIT;
export function useAppUpdate(view: UpdateView) {
  const latestView = useRef(view);
  useLayoutEffect(() => { latestView.current = view; }, [view]);
  const owner = useRef<ReturnType<typeof createAppUpdater> | null>(null);
  const [state, setState] = useState<UpdateState>({ target: null, status: "", refreshing: false });
  useEffect(() => {
    const updater = createAppUpdater(LOADED_COMMIT, setState, commit => location.replace(refreshUrl(location.href, commit, latestView.current)));
    owner.current = updater;
    return () => { owner.current = null; updater.dispose(); };
  }, []);
  return { ...state, check: () => owner.current?.check(), refresh: () => owner.current?.refresh(), dismiss: () => owner.current?.dismiss() };
}
export type AppUpdate = ReturnType<typeof useAppUpdate>;
