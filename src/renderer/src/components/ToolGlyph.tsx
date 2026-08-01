import {
  Bot,
  Cable,
  Copy,
  FileCode2,
  FilePenLine,
  FilePlus2,
  Files,
  Globe2,
  Image,
  ListTree,
  MessageCircleQuestion,
  SearchCode,
  SquareTerminal,
  Terminal,
  Trash2,
  Waypoints,
  Wrench
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

const iconForTool = (name: string): LucideIcon => {
  const tool = name.toLocaleLowerCase()
  if (tool === "bash" || tool === "terminal" || tool === "exec") return Terminal
  if (tool === "read") return FileCode2
  if (tool === "write") return FilePlus2
  if (tool === "edit" || tool.includes("patch")) return FilePenLine
  if (tool === "ffgrep" || tool === "grep" || tool.includes("search")) return SearchCode
  if (tool === "fffind" || tool === "find" || tool === "glob") return Files
  if (tool === "mcp" || tool.includes("connect")) return Cable
  if (tool === "map" || tool.includes("graph")) return Waypoints
  if (tool.startsWith("subagent")) return Bot
  if (tool.startsWith("bg_")) return SquareTerminal
  if (tool === "ask_user") return MessageCircleQuestion
  if (tool.includes("browser") || tool.includes("web") || tool.includes("url")) return Globe2
  if (tool.includes("image") || tool.includes("screenshot")) return Image
  if (tool.includes("tree") || tool === "list" || tool === "ls") return ListTree
  if (tool.includes("copy")) return Copy
  if (tool.includes("delete") || tool.includes("remove")) return Trash2
  return Wrench
}

export function ToolGlyph({ name, className = "tool-icon", size = 14 }: { readonly name: string; readonly className?: string; readonly size?: number }) {
  const Icon = iconForTool(name)
  return <Icon className={className} size={size} aria-hidden="true" />
}
