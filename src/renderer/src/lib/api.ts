import type { PiDesktopApi } from "../../../shared/contracts"
import { createE2eApi } from "./e2eApi"

const resolveDesktopApi = (): PiDesktopApi => window.piDesktop ?? createE2eApi()

export const desktopApi = resolveDesktopApi()
