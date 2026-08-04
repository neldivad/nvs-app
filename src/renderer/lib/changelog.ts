/** The repo-root CHANGELOG.md, inlined at build time (Vite `?raw`). Bumping the app version appends a section
 *  there; the header version chip renders this. One source of truth — the file IS the changelog. */
import raw from '../../../CHANGELOG.md?raw'

export const CHANGELOG: string = raw
