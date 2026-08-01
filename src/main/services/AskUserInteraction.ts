import { Schema } from "effect"
import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
  KeybindingsManager,
  Theme,
  WorkingIndicatorOptions
} from "@earendil-works/pi-coding-agent"
import { Theme as PiTheme } from "@earendil-works/pi-coding-agent"
import {
  KeybindingsManager as TuiKeybindingsManager,
  TUI,
  TUI_KEYBINDINGS,
  type Component,
  type EditorComponent,
  type EditorTheme,
  type Terminal
} from "@earendil-works/pi-tui"
import type {
  AskUserInteractionAnswer,
  AskUserInteractionRequest
} from "../../shared/interaction"

export class AskUserUiError extends Schema.TaggedErrorClass<AskUserUiError>()("AskUserUiError", {
  reason: Schema.Literals(["busy", "disposed", "missing", "unsupported", "invalid", "factory"]),
  message: Schema.String
}) {}

type CustomFactory<T> = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result: T) => void
) => Component | Promise<Component>

const hasDispose = (component: Component): component is Component & { readonly dispose: () => void } =>
  "dispose" in component && typeof component.dispose === "function"

const disposeComponent = (component: Component | undefined): void => {
  if (component && hasDispose(component)) component.dispose()
}

const isComponent = (value: unknown): value is Component =>
  typeof value === "object" && value !== null && "render" in value && typeof value.render === "function" && "invalidate" in value && typeof value.invalidate === "function"

const componentFromUnknown = (value: unknown): Component => {
  if (!isComponent(value)) throw new Error("The extension custom UI did not return a renderable component")
  return value
}

interface CustomWaiter {
  readonly start: (offer: QuestionOffer) => void
  paired: boolean
}

interface QuestionOffer {
  readonly request: AskUserInteractionRequest
  readonly visible: boolean
  readonly rejection?: AskUserUiError
  paired: boolean
  settled: boolean
  cancelRequested: boolean
  queuedAnswer?: AskUserInteractionAnswer
  component?: Component
  forceReject?: (error: AskUserUiError) => void
}

const headlessTerminal: Terminal = {
  start: () => undefined,
  stop: () => undefined,
  drainInput: async () => undefined,
  write: () => undefined,
  get columns() {
    return 120
  },
  get rows() {
    return 40
  },
  get kittyProtocolActive() {
    return false
  },
  moveBy: () => undefined,
  hideCursor: () => undefined,
  showCursor: () => undefined,
  clearLine: () => undefined,
  clearFromCursor: () => undefined,
  clearScreen: () => undefined,
  setTitle: () => undefined,
  setProgress: () => undefined
}

const headlessTui = new TUI(headlessTerminal, false)
const headlessKeybindings = new TuiKeybindingsManager(TUI_KEYBINDINGS)

const headlessForeground = {
  accent: "#e9a868",
  border: "#303234",
  borderAccent: "#e9a868",
  borderMuted: "#252729",
  success: "#8cc9a1",
  error: "#e4897f",
  warning: "#e9a868",
  muted: "#918d88",
  dim: "#716d69",
  text: "#f0efed",
  thinkingText: "#918d88",
  userMessageText: "#dfddda",
  customMessageText: "#d7d5d2",
  customMessageLabel: "#e9a868",
  toolTitle: "#c6c1bc",
  toolOutput: "#c2bfbb",
  mdHeading: "#f0efed",
  mdLink: "#efb57b",
  mdLinkUrl: "#c99568",
  mdCode: "#efbd8a",
  mdCodeBlock: "#d7d5d2",
  mdCodeBlockBorder: "#303234",
  mdQuote: "#bbb7b2",
  mdQuoteBorder: "#48423d",
  mdHr: "#393b3d",
  mdListBullet: "#b98559",
  toolDiffAdded: "#8cc9a1",
  toolDiffRemoved: "#e4897f",
  toolDiffContext: "#918d88",
  syntaxComment: "#77736f",
  syntaxKeyword: "#e9a868",
  syntaxFunction: "#d8ad83",
  syntaxVariable: "#c9c4bf",
  syntaxString: "#9cc29f",
  syntaxNumber: "#d8b28b",
  syntaxType: "#a8b7cc",
  syntaxOperator: "#c1aaa0",
  syntaxPunctuation: "#918d88",
  thinkingOff: "#716d69",
  thinkingMinimal: "#8a8177",
  thinkingLow: "#a08468",
  thinkingMedium: "#b98559",
  thinkingHigh: "#c98b52",
  thinkingXhigh: "#d5965e",
  thinkingMax: "#e9a868",
  bashMode: "#9f7957"
}

const headlessBackground = {
  selectedBg: "#2c2118",
  userMessageBg: "#191a1b",
  customMessageBg: "#151617",
  toolPendingBg: "#201810",
  toolSuccessBg: "#142019",
  toolErrorBg: "#241716"
}

const headlessTheme = new PiTheme(headlessForeground, headlessBackground, "truecolor", { name: "pi-desktop" })

const unsupported = (method: string): Promise<never> => Promise.reject(
  AskUserUiError.make({
    reason: "unsupported",
    message: `Pi Desktop does not expose extension UI method ${method}`
  })
)

export interface AskUserInteractionBridgeOptions {
  readonly sessionPath: string
  readonly onRequest: (request: AskUserInteractionRequest) => void
  readonly onClear: (requestId: string) => void
}

/**
 * Adapts Pi's TUI-only `ctx.ui.custom` hook to the renderer.
 *
 * The installed ask_user extension creates its own component and calls `done`
 * when that component receives terminal input. We create that real component
 * with a headless TUI, then replay the renderer's typed answer as the exact
 * option/text/escape input the extension expects. This keeps the waiting tool
 * promise owned by Pi instead of manufacturing a tool result in the desktop.
 */
export class AskUserInteractionBridge {
  readonly uiContext: ExtensionUIContext

  private readonly sessionPath: string
  private readonly onRequest: (request: AskUserInteractionRequest) => void
  private readonly onClear: (requestId: string) => void
  private readonly offers: QuestionOffer[] = []
  private readonly waiters: CustomWaiter[] = []
  private disposed = false

  constructor(options: AskUserInteractionBridgeOptions) {
    this.sessionPath = options.sessionPath
    this.onRequest = options.onRequest
    this.onClear = options.onClear
    this.uiContext = {
      select: (_title: string, _options: string[], _opts?: ExtensionUIDialogOptions) => unsupported("select"),
      confirm: (_title: string, _message: string, _opts?: ExtensionUIDialogOptions) => unsupported("confirm").then(() => false),
      input: (_title: string, _placeholder?: string, _opts?: ExtensionUIDialogOptions) => unsupported("input"),
      notify: () => undefined,
      onTerminalInput: () => () => undefined,
      setStatus: () => undefined,
      setWorkingMessage: (_message?: string) => undefined,
      setWorkingVisible: (_visible: boolean) => undefined,
      setWorkingIndicator: (_options?: WorkingIndicatorOptions) => undefined,
      setHiddenThinkingLabel: (_label?: string) => undefined,
      setWidget: (_key: string, _content: string[] | ((tui: TUI, theme: Theme) => Component) | undefined, _options?: ExtensionWidgetOptions) => undefined,
      setFooter: () => undefined,
      setHeader: () => undefined,
      setTitle: () => undefined,
      custom: <T>(factory: CustomFactory<T>) => this.custom(factory),
      pasteToEditor: () => undefined,
      setEditorText: () => undefined,
      getEditorText: () => "",
      editor: (_title: string, _prefill?: string) => unsupported("editor"),
      addAutocompleteProvider: () => undefined,
      setEditorComponent: (_factory: ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined) => undefined,
      getEditorComponent: () => undefined,
      theme: headlessTheme,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is unavailable in Pi Desktop extension UI" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => undefined
    }
  }

  register(request: AskUserInteractionRequest): void {
    if (this.disposed) return

    const busy = this.offers.some((offer) => offer.visible && !offer.settled)
    const offer: QuestionOffer = {
      request,
      visible: !busy,
      ...(busy
        ? {
            rejection: AskUserUiError.make({
              reason: "busy",
              message: "Pi Desktop already has an ask_user question open"
            })
          }
        : {}),
      paired: false,
      settled: false,
      cancelRequested: false
    }
    this.offers.push(offer)

    if (offer.visible) {
      try {
        this.onRequest(request)
      } catch (cause) {
        this.failOffer(offer, AskUserUiError.make({ reason: "factory", message: cause instanceof Error ? cause.message : String(cause) }))
      }
    }
    this.pairOffers()
  }

  pendingRequest(): AskUserInteractionRequest | undefined {
    return this.offers.find((offer) => offer.visible && !offer.settled)?.request
  }

  answer(requestId: string, answer: AskUserInteractionAnswer): void {
    if (answer.kind === "custom" && !answer.answer.trim()) {
      throw AskUserUiError.make({ reason: "invalid", message: "A custom ask_user answer cannot be empty" })
    }

    const offer = this.offers.find((candidate) => candidate.visible && !candidate.settled && candidate.request.requestId === requestId)
    if (!offer) {
      throw AskUserUiError.make({ reason: "missing", message: "The ask_user question is no longer waiting for an answer" })
    }
    if (offer.queuedAnswer) {
      throw AskUserUiError.make({ reason: "invalid", message: "The ask_user question already has an answer" })
    }
    if (answer.kind === "option" && answer.optionIndex >= offer.request.options.length) {
      throw AskUserUiError.make({ reason: "invalid", message: "The selected ask_user option is unavailable" })
    }

    offer.queuedAnswer = answer
    this.deliver(offer, answer)
  }

  cancelPending(): void {
    const offer = this.offers.find((candidate) => candidate.visible && !candidate.settled)
    if (!offer || offer.queuedAnswer) return
    offer.cancelRequested = true
    this.deliver(offer, { kind: "dismissed" })
  }

  finishTool(toolCallId: string): void {
    const offer = this.offers.find((candidate) => candidate.request.toolCallId === toolCallId && !candidate.settled)
    if (!offer) return
    if (offer.component) {
      this.deliver(offer, { kind: "dismissed" })
    } else {
      this.failOffer(offer, AskUserUiError.make({ reason: "missing", message: "The ask_user tool finished before its question UI was ready" }))
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const disposedError = AskUserUiError.make({ reason: "disposed", message: "The Pi session no longer owns this ask_user question" })

    for (const waiter of this.waiters.splice(0)) {
      waiter.paired = true
      waiter.start({
        request: {
          requestId: "disposed",
          toolCallId: "disposed",
          question: "",
          options: []
        },
        visible: false,
        rejection: disposedError,
        paired: true,
        settled: false,
        cancelRequested: false
      })
    }

    for (const offer of [...this.offers]) {
      if (offer.settled) continue
      if (offer.component) {
        this.deliver(offer, { kind: "dismissed" })
      } else {
        this.failOffer(offer, disposedError)
      }
    }
  }

  private custom<T>(factory: CustomFactory<T>): Promise<T> {
    if (this.disposed) return Promise.reject(AskUserUiError.make({ reason: "disposed", message: "Pi Desktop extension UI has been disposed" }))

    return new Promise<T>((resolve, reject) => {
      const waiter: CustomWaiter = {
        paired: false,
        start: (offer) => this.startFactory(offer, factory, resolve, reject)
      }
      this.waiters.push(waiter)
      this.pairOffers()
      queueMicrotask(() => {
        if (waiter.paired || this.disposed) return
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        waiter.paired = true
        reject(AskUserUiError.make({ reason: "unsupported", message: "Pi Desktop only supports the installed ask_user custom UI" }))
      })
    })
  }

  private pairOffers(): void {
    while (this.waiters.length > 0) {
      const offer = this.offers.find((candidate) => !candidate.paired && !candidate.settled)
      const waiter = this.waiters.shift()
      if (!offer || !waiter) return
      offer.paired = true
      waiter.paired = true
      waiter.start(offer)
    }
  }

  private startFactory<T>(offer: QuestionOffer, factory: CustomFactory<T>, resolve: (value: T) => void, reject: (reason?: unknown) => void): void {
    const settleSuccess = (value: T): void => {
      if (offer.settled) return
      offer.settled = true
      disposeComponent(offer.component)
      this.onClearIfVisible(offer)
      this.removeOffer(offer)
      resolve(value)
    }
    const settleFailure = (reason: AskUserUiError): void => {
      if (offer.settled) return
      offer.settled = true
      disposeComponent(offer.component)
      this.onClearIfVisible(offer)
      this.removeOffer(offer)
      reject(reason)
    }

    offer.forceReject = settleFailure
    if (offer.rejection) {
      settleFailure(offer.rejection)
      return
    }

    void Promise.resolve()
      .then(() => Reflect.apply(factory, undefined, [headlessTui, headlessTheme, headlessKeybindings, settleSuccess]))
      .then((value) => {
        const component = componentFromUnknown(value)
        if (offer.settled) {
          disposeComponent(component)
          return
        }
        offer.component = component
        if (offer.cancelRequested) {
          this.deliver(offer, { kind: "dismissed" })
        } else if (offer.queuedAnswer) {
          const answer = offer.queuedAnswer
          offer.queuedAnswer = undefined
          this.deliver(offer, answer)
        }
      })
      .catch((cause: unknown) => {
        settleFailure(AskUserUiError.make({
          reason: "factory",
          message: cause instanceof Error ? cause.message : String(cause)
        }))
      })
  }

  private deliver(offer: QuestionOffer, answer: AskUserInteractionAnswer): void {
    const component = offer.component
    if (!component) return
    const handleInput = component.handleInput
    if (!handleInput) {
      offer.forceReject?.(AskUserUiError.make({ reason: "factory", message: "The ask_user extension component cannot receive input" }))
      return
    }

    try {
      if (answer.kind === "dismissed") {
        handleInput.call(component, "\x1b")
      } else if (answer.kind === "option") {
        handleInput.call(component, String(answer.optionIndex + 1))
      } else {
        handleInput.call(component, String(offer.request.options.length + 1))
        for (const character of answer.answer) {
          handleInput.call(component, character === "\n" || character === "\r" ? "\x1b[27;2;13~" : character)
        }
        handleInput.call(component, "\r")
      }
    } catch (cause) {
      offer.forceReject?.(AskUserUiError.make({ reason: "factory", message: cause instanceof Error ? cause.message : String(cause) }))
    }
  }

  private failOffer(offer: QuestionOffer, error: AskUserUiError): void {
    if (offer.forceReject) {
      offer.forceReject(error)
      return
    }
    offer.settled = true
    this.onClearIfVisible(offer)
    this.removeOffer(offer)
  }

  private onClearIfVisible(offer: QuestionOffer): void {
    if (offer.visible) this.onClear(offer.request.requestId)
  }

  private removeOffer(offer: QuestionOffer): void {
    const index = this.offers.indexOf(offer)
    if (index >= 0) this.offers.splice(index, 1)
    this.pairOffers()
  }
}
