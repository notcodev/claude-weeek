/**
 * Shared copy for the `description` field of the write tools.
 *
 * WEEEK's task editor renders a small HTML subset. There is no sanitizer on
 * the write path — the string is sent verbatim — so this guidance advertises
 * exactly the tags WEEEK is known to render, and no others. Kept in one place
 * so weeek_create_task and weeek_update_task cannot drift apart.
 */
export const DESCRIPTION_HTML_GUIDANCE =
  'Task description / body. Optional. Supports a small HTML subset rendered by ' +
  'the WEEEK editor. Allowed tags only: <p> (paragraph), <strong> (bold), ' +
  '<em> (italic), <a href="..."> (link), <br> (line break inside a paragraph), ' +
  '<ul>/<ol> with <li> (bullet / numbered lists). Wrap each paragraph in ' +
  '<p>...</p>. Do NOT use Markdown, headings, tables, or any tag outside this ' +
  "list — unsupported tags are stored raw and won't render. Escape literal " +
  '<, >, & in text as &lt;, &gt;, &amp;. Plain text is still accepted.'

/** Same guidance, plus the update-only clarification about omitted/empty values. */
export const DESCRIPTION_HTML_GUIDANCE_UPDATE = `${DESCRIPTION_HTML_GUIDANCE} Omit to leave unchanged. Pass empty string to clear.`
