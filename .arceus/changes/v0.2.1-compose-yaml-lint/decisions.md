# v0.2.1 — Decisions

## Package choice

- **`yaml` (eemeli/yaml), not `js-yaml`.** `yaml` is TypeScript-native,
  exposes `errors[]` / `warnings[]` with `linePos` info that maps
  cleanly onto Monaco markers, and is already what v0.2's
  `decisions.md` recommended.

## Debounce window

- **~200 ms.** Long enough to avoid re-parsing on every keystroke,
  short enough that the lint feels real-time. Mirrors what most IDEs
  do for syntax-level linters.

## Marker owner string

- **`'yaml'`.** The second argument to `setModelMarkers` is an "owner"
  label so multiple producers can coexist. Using `'yaml'` makes future
  additions (e.g. a separate Compose-schema lint) trivially additive
  without stomping on each other.

## What this is not

- Not a Compose-schema validator. The `yaml` package only parses YAML;
  it doesn't know `services:` from `volumes:`. The Validate button
  remains the only path for semantic validation.
- Not an auto-fix layer. Markers report; they don't repair.
- Not a JSON-Schema-against-Compose-Spec layer. That's a much bigger
  scope and not part of this polish.
