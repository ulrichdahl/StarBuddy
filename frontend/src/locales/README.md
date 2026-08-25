# UI translations

One JSON file per language: `en.json` (fallback, always complete) and `da.json`.
Add a language by copying `en.json`, translating, and listing the code in
`SUPPORTED_LOCALES` / `LOCALE_NAMES` in `../i18n.ts` and the `locale`
validation in `backend/app/Http/Controllers/ProfileController.php`.

Rules:
- **Never translate game data**: item, material, blueprint, location, system,
  manufacturer names, stat/fire-mode names, quality numbers — anything that
  comes from the API is shown verbatim. Only UI copy lives here.
- Keys are grouped by area (`common`, `nav`, `dashboard`, `craft`, …), camelCase.
- Interpolation: `"crafted": "Crafted {{name}}"` → `t('craft.crafted', { name })`.
- Plurals: `"members_one": "{{count}} member"`, `"members_other": "{{count}} members"`
  → `t('org.members', { count })`.
- Product names stay as written: StarBuddy, Star Citizen, Discord, Game.log.
- Dates/numbers: format with the active language, `toLocaleString(i18n.language)`.
