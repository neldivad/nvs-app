/**
 * World-page body helpers.
 *
 * World pages are authored as plain Markdown — no WYSIWYG, no parse/serialize round-trip.
 * The Write tab edits the raw text (with a slash-command palette that inserts section
 * templates); the Preview tab renders it. These helpers just reason about `## sections`
 * so the slash menu and PropertyDialog know which modules are already on the page.
 */

/** The `##`/`###` heading texts present in a body, in document order. */
export function bodyHeadings(md: string): string[] {
  const out: string[] = []
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const m = line.match(/^#{2,3}\s+(.*)$/)
    if (m) out.push(m[1].trim())
  }
  return out
}

/** True if the body already contains a `## heading` matching `heading` (case-insensitive). */
export function hasSection(md: string, heading: string): boolean {
  const want = heading.trim().toLowerCase()
  return bodyHeadings(md).some((h) => h.toLowerCase() === want)
}

/**
 * Append a section `template` to the body if its `heading` isn't already present.
 * Returns the (possibly unchanged) body. Used by the wizard + slash palette to insert a
 * module once.
 */
export function ensureSection(md: string, heading: string, template: string): string {
  if (hasSection(md, heading)) return md
  const block = template.trimEnd()
  return md.trim() === '' ? `${block}\n` : `${md.replace(/\s+$/, '')}\n\n${block}\n`
}
