import { describe, it, expect } from 'vitest'
import { TOOL_CATALOG, TOOL_NAMES, TOOL_CAPS, IN_APP_TOOLS } from '../src/shared/config/aiTools'
import { serves, LIFECYCLE_CAPS } from '../src/engine/hostApi'

/**
 * The Host-API v1 FREEZE conformance (internal/host-api-v1-spec.md Part A). This is what makes "frozen" mean
 * something: it pins tool ↔ capability ↔ hostApi.SUPPORTED, so a breaking change to a `/1` tool fails the build
 * (forcing a deliberate `/2` per the CLAP rules) instead of silently breaking a consumer.
 */
describe('Host API v1 surface (the freeze)', () => {
  it('every tool is capability-tagged, and every tag maps to a real tool (completeness)', () => {
    expect(TOOL_NAMES.slice().sort()).toEqual(Object.keys(TOOL_CAPS).sort())
  })

  it("every tool's capability is served (read/write) or a trusted lifecycle cap", () => {
    for (const [name, { cap, tier }] of Object.entries(TOOL_CAPS)) {
      if (tier === 'lifecycle') {
        // Lifecycle caps are trusted-adapter-only: in LIFECYCLE_CAPS, and deliberately NOT negotiable to a manifest.
        expect(LIFECYCLE_CAPS.has(cap), `${name}: lifecycle cap ${cap} must be in LIFECYCLE_CAPS`).toBe(true)
        expect(serves(cap), `${name}: lifecycle cap ${cap} must NOT be served to sandboxed manifests`).toBe(false)
      } else {
        expect(serves(cap), `${name}: capability ${cap} is not served by hostApi (SUPPORTED/FAMILIES)`).toBe(true)
      }
    }
  })

  it('a tool\'s capability namespace matches its tier', () => {
    for (const [name, { cap, tier }] of Object.entries(TOOL_CAPS)) {
      expect(cap.startsWith(`${tier}:`) || cap.startsWith(`${tier}/`), `${name}: ${cap} should be in the ${tier} namespace`).toBe(true)
    }
  })

  it('IN_APP_TOOLS excludes lifecycle tools but keeps every read/write tool (the in-app trust gate)', () => {
    const inApp = new Set(IN_APP_TOOLS.map((t) => t.name))
    for (const [name, { tier }] of Object.entries(TOOL_CAPS)) {
      if (tier === 'lifecycle') expect(inApp.has(name), `${name} (lifecycle) must NOT be exposed in-app`).toBe(false)
      else expect(inApp.has(name), `${name} (${tier}) must be exposed in-app`).toBe(true)
    }
  })

  it('the frozen surface signature — a breaking /1 change must fail here (then mint /2 deliberately)', () => {
    // name + capability + tier + write-flag + the sorted input param names. Any rename, param add/remove, or cap
    // change flips this → the snapshot fails → the change is a conscious contract decision, never accidental.
    const signature = TOOL_CATALOG.map((t) => {
      const c = TOOL_CAPS[t.name]
      const params = Object.keys(t.input).sort().join(',')
      return `${t.name} [${c.cap} · ${c.tier}${t.write ? ' · write' : ''}] (${params})`
    }).sort()
    expect(signature).toMatchSnapshot()
  })
})
