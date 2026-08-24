---
name: frontend-stack-mui9
description: StarMaker frontend uses MUI v9 + React 19 + Vite 8 + TS 6 — v9 API gotchas that differ from v5/v6 muscle memory
metadata:
  type: project
---

StarMaker's frontend (frontend/) runs MUI v9.x, React 19, Vite 8 (rolldown), TypeScript ~6.0 with strict flags (noUnusedLocals, verbatimModuleSyntax, erasableSyntaxOnly).

**Why:** scaffolded 2026-08-24; v9 removed things older MUI code assumes, and TS 6 narrows aliased conditions, so v5-era patterns fail the build.

**How to apply:**
- MUI v9 `Stack` accepts ONLY children/direction/spacing/divider/useFlexGap/sx — no system props. Put `alignItems`, `justifyContent`, `flexWrap` etc. in `sx`.
- Icon `ErrorOutline` no longer exists; the export is `@mui/icons-material/ErrorOutlined`.
- Use `slotProps={{ htmlInput: ... }}` on TextField (inputProps is gone/deprecated).
- TS 6 narrows through aliased boolean consts: after `if (!canSubmit)` where canSubmit included `x !== ''`, a later `x === ''` check becomes a TS2367 no-overlap error — order guards so the raw check runs before the alias narrows.
- Theme tokens: bg #0C1117, paper #121A23, primary cyan #5BC8DB, secondary amber #E8B45A (src/theme.ts). Dark-only, industrial sci-fi.
- Sticky quick-entry pattern (bulk-entry ergonomics) lives in src/components/ResourceEntryForm.tsx / ItemEntryForm.tsx: on submit keep location/visibility/quality, clear subject+quantity, refocus first field.
