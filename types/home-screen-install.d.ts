/** Public mount API for the pinned, immutable ES module distribution. */
declare module "@/src/vendor/home-screen-install/home-screen-install.mjs" {
  export function mount(container: Element, options: { appName: string; label?: string; nonce?: string }): {
    open(): boolean;
    close(): void;
    destroy(): void;
  };
}
