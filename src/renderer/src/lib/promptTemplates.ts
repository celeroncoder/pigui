import type { PiCommand } from "../../../shared/contracts"

export interface CommandQuery {
  readonly query: string
  readonly kind?: PiCommand["kind"]
}

/** A command is suggested only while its invocation token is being composed. */
export const commandQuery = (text: string): CommandQuery | null => {
  const skill = /^(?:\/skill:|\$)([^\s]*)$/.exec(text)
  if (skill) return { query: skill[1].toLocaleLowerCase(), kind: "skill" }
  const command = /^\/([^\s]*)$/.exec(text)
  return command ? { query: command[1].toLocaleLowerCase() } : null
}

export const commandText = (command: PiCommand): string =>
  command.kind === "skill" ? `/skill:${command.name}` : `/${command.name}`

export const filterPiCommands = (commands: ReadonlyArray<PiCommand>, query: CommandQuery) => {
  const seen = new Set<string>()
  return commands.filter((command) => {
    const invocation = commandText(command)
    // AgentSession resolves a skill command before it tries a prompt template.
    // Preserve that order so no two choices render the same executable text.
    if (seen.has(invocation)) return false
    seen.add(invocation)
    return (!query.kind || command.kind === query.kind)
      && (invocation.toLocaleLowerCase().includes(query.query) || command.description.toLocaleLowerCase().includes(query.query))
  })
}

/** Pi receives the selected command unchanged and performs native expansion. */
export const piCommandText = (command: PiCommand): string => `${commandText(command)} `
