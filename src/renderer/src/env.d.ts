import type { PiDesktopApi } from "../../shared/contracts"

declare global {
  interface Window {
    readonly piDesktop: PiDesktopApi
  }
}

export {}
