# Task Description HTML Formatting — Design

- **Date:** 2026-07-06
- **Status:** Approved (design); implementation plan pending
- **Author:** Erik Codev (with Claude Code)

## Problem

`weeek_create_task` and `weeek_update_task` accept a `description` field and send
it to WEEEK verbatim. Today the schema documents it as *"Plain text; WEEEK may
render basic formatting."* As a result agents write plain, unformatted text into
`description`, which renders as an unbroken raw block in the WEEEK UI — hard to
read, no paragraphs, no emphasis, no lists.

WEEEK's task editor is a rich-text editor and renders a subset of HTML in the
`description` field. Example known to render correctly:

```html
<p><strong>Summary:</strong> login form rejects valid credentials.</p>
<p>Steps to reproduce:<br>1. Open the login page.<br>2. Enter a known-good email and password.<br>3. Submit.</p>
```

We want agents to produce this kind of formatted HTML instead of raw text, so
descriptions read well in the WEEEK interface. This is phase 1 of a broader
effort to use more of the WEEEK editor's capabilities.

## Approach

The chosen interface is **HTML passthrough, no processing** (decided during
brainstorming, over "Markdown → HTML conversion" and "HTML + sanitizer"):

- The agent writes HTML directly into `description`.
- The tool sends it to WEEEK unchanged.

The code already does this — `body.description = args.description` is a raw
passthrough in both tools. **No wire behavior changes.** The entire change is to
the *guidance the model sees*: the tool `description` strings and the
`.describe()` text on the `description` input field.

Because there is no sanitizer, the advertised tag set must be exactly the set
WEEEK actually renders. Advertising a tag WEEEK ignores would produce broken
output. The agreed whitelist:

| Tag | Purpose |
|-----|---------|
| `<p>` | paragraph |
| `<strong>` | bold |
| `<em>` | italic |
| `<a href="…">` | link |
| `<br>` | line break inside a paragraph |
| `<ul>` / `<ol>` + `<li>` | bullet / numbered lists |

**Assumption to verify:** `p / strong / em / a / br` are standard rich-text-editor
tags and near-certain to render. `ul / ol / li` are also standard but not yet
confirmed against live WEEEK. Confirm with one live `create_task` before merge;
if lists don't render, drop them from the whitelist.

## Changes

Two source files, documentation-only:

1. **`src/tools/write/_shared.ts`** (new) — export a single constant
   `DESCRIPTION_HTML_GUIDANCE` holding the shared guidance sentence, so the two
   tools cannot drift apart.

2. **`src/tools/write/create-task.ts`** — replace the `description` field
   `.describe()` with `DESCRIPTION_HTML_GUIDANCE` (marked Optional); add a short
   note to the tool-level `description` that the body accepts a WEEEK HTML subset.

3. **`src/tools/write/update-task.ts`** — same, with the update-specific tail
   *"Omit to leave unchanged. Pass empty string to clear."*

### Proposed guidance text (in English)

Field-level `.describe()` (create):

> Task description / body. Optional. Supports a small HTML subset rendered by the
> WEEEK editor. Allowed tags only: `<p>` (paragraph), `<strong>` (bold), `<em>`
> (italic), `<a href="…">` (link), `<br>` (line break inside a paragraph), `<ul>`
> / `<ol>` with `<li>` (bullet / numbered lists). Wrap each paragraph in
> `<p>…</p>`. Do NOT use Markdown, headings, tables, or any tag outside this list
> — unsupported tags are stored raw and won't render. Escape literal `<`, `>`, `&`
> in text as `&lt;`, `&gt;`, `&amp;`. Plain text is still accepted.

For `update-task`, append: *"Omit to leave unchanged. Pass empty string to clear."*

Tool-level `description` addition (both tools): a clause noting `description`
accepts a limited WEEEK HTML subset (see the field guidance).

## Out of scope

- **Read tools** (`get_task`, `list_tasks`): descriptions read back will now
  contain HTML. This is readable for an agent and needs no change. The response
  shaper already passes `description` through unchanged.
- **Sanitization / Markdown conversion:** explicitly rejected in brainstorming.
- **Other editor features** (attachments, mentions, custom fields formatting):
  future phases.

## Wire / spec-drift impact

None. The request field remains `description` with the same type (string). No
new fields, verbs, paths, or query params. `pnpm spec:check` is unaffected.

## Testing

Wire behavior is unchanged, so there are no new functional assertions. Verify
during implementation that no existing test snapshots the `.describe()` text
(unlikely); update if one does. `pnpm typecheck`, `pnpm lint`, and the existing
test suite must stay green. Optionally do one live `create_task` to confirm the
`ul/ol/li` assumption above.
