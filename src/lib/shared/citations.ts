/** Internal source identity, never an external navigation target. */
export function citationId(href: string): string | undefined {
  return /^cite:([A-Za-z0-9_-]{16})$/.exec(href)?.[1];
}
