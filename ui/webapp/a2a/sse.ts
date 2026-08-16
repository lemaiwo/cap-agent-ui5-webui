export interface SSEFrame {
  event?: string
  data: string
}

export function parseSSE(
  buffer: string,
  chunk: string,
): { frames: SSEFrame[]; rest: string } {
  const combined = (buffer + chunk).replace(/\r\n/g, "\n")
  const blocks = combined.split("\n\n")
  const rest = blocks.pop() ?? ""
  const frames: SSEFrame[] = []

  for (const block of blocks) {
    if (!block.trim()) continue

    let event: string | undefined
    const dataLines: string[] = []

    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""))
    }

    if (dataLines.length) frames.push({ event, data: dataLines.join("\n") })
  }

  return { frames, rest }
}
