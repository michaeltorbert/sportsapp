"use client";

import { useEffect, useRef } from "react";
import { mount } from "@/src/vendor/home-screen-install/home-screen-install.mjs";

/** One shared guide outside the page's hidden views and modal panels. */
export function HomeScreenInstall() {
  const container = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const install = mount(container.current, { appName: "Saturday Signal" });
    return () => install.destroy();
  }, []);

  // The shared host owns current-mode visibility. CSS collapses this footer
  // when that host is hidden, without duplicating the package's mode checks.
  return <footer ref={container} className="home-screen-install-footer" aria-label="Home Screen installation" />;
}
