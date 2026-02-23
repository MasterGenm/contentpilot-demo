export function encodeSSE(data: object): string {
  return `${JSON.stringify(data)}\n`
}

