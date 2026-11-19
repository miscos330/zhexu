# Deployment extensions

A deployment extension packages what a downstream deployment adds on top of
upstream OpenMAIC: its brand, its theme and the entries it puts into the
workspace shell. Everything lives under `extensions/<id>/`, so the upstream tree
stays easy to rebase.

With no extension selected the app renders exactly the upstream product.

## Enable one

```env
# .env.local
NEXT_PUBLIC_DEPLOYMENT_EXTENSION=zhexu
NEXT_PUBLIC_WORKBENCH_ENABLED=true   # the brand and the shell slots show in the workbench
```

The variable is compiled into the browser bundle, so restart `pnpm dev` or
rebuild after changing it. Unknown values select nothing.

## What an extension can change

| Surface                                                           | How                                                                  | Upstream seam                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| Product name, logo, mark                                          | `BrandProvider` with a `BrandConfig`                                 | `lib/brand/brand-context.tsx`                   |
| Rail pages, account menu entries, account summary, home section   | `WorkbenchShellExtensionsProvider`                                   | `lib/workbench/shell-extensions.tsx`            |
| Sign-in identity, guide course                                    | the same provider (`identity`, `guideCourse`); not used yet          | `lib/workbench/shell-extensions.tsx`            |
| Colours                                                           | custom properties scoped to `html[data-brand='<id>']`                | `app/globals.css`, Tailwind's colour scales     |
| Browser tab title, description                                    | `extensions/metadata.ts`                                             | the `metadata` export of `app/layout.tsx`       |
| Agent tools of its own                                            | `extensions/agent-tools.ts`, called once per run                     | `lib/server/agent-runtime/runner.ts`            |
| What the conversation shows for a finished call of such a tool    | `extensions/tool-cards.tsx`                                          | `components/workbench/chat/action-cluster.tsx`  |
| HTTP endpoints of its own                                         | route files under `app/api/extensions/<id>/` that only forward       | none                                            |

## Files

```
extensions/
  config.ts        which extension is active (server and client safe)
  index.tsx        mounts the active extension inside the root layout's provider
  metadata.ts      page title and description per extension
  zhexu/
    brand.ts       BrandConfig and links
    messages.ts    the extension's own strings (Chinese, English fallback)
    shell.tsx      providers and the workspace shell slots
    about-page.tsx the rail page at /workspace?view=zhexu-about
    theme.css      hand-written colour tokens
    theme-upstream-literals.css   generated, see below
    scripts/sync-upstream-accent.mjs
    site/          the static showcase page, see site/README.md
    agent-tools.ts the extension's agent tools, each behind its own switch
    tool-cards.tsx the cards of those tools
    deliverables/  A4 handouts, see below
    annotations/   image annotations, see below
  agent-tools.ts   server seam: the active extension's agent tools
  tool-cards.tsx   client seam: the active extension's tool cards
app/api/extensions/zhexu/  route files that forward to extensions/zhexu/
public/extensions/zhexu/   brand assets, fonts and their provenance
tests/extensions/          tests
.github/README.md          the ZHEXU front page, with README-zh.md beside it.
                           GitHub shows it in place of the README at the root,
                           which stays upstream's
```

The only upstream files touched are `app/layout.tsx` (two imports, the
`data-brand` attribute, the `DeploymentExtensions` wrapper and one spread in
`metadata`), `lib/server/agent-runtime/runner.ts` (one import and one call that
appends the extension's tools to the run's own), `components/workbench/chat/action-cluster.tsx`
(one import and a wrapper that puts the extension's cards under a row of tool
calls, where they stay in view when the row folds) and `.env.example` (one
section at the end). `Dockerfile` and `docker-compose.yml` take
`NEXT_PUBLIC_DEPLOYMENT_EXTENSION` as one more build argument. Outside the code, the issue forms in
`.github/ISSUE_TEMPLATE/` (`bug_report.yml`, `config.yml`) ask about this
repository and point everything else upstream.

## A4 handouts (ZHEXU)

With the switch on, the agent can hand over an answer as real files instead of
text to copy: an A4 PDF, an image of the first page and, for more than one page,
a ZIP of every page. `style=handwriting` sets the body in a Chinese running-hand
face. The conversation shows a card with a preview, the download links and a
"Check files" button.

`create_course_handout` makes the same files from one of the owner's saved
courses: what is written on each page, the narration and the quiz questions, in
page order, with the answers at the end. The text is taken from the course as
it is saved; no model writes or shortens it, and a course too long for sixteen
pages is refused with a hint to export a range of pages. `content=slides`
leaves the narration out and `content=questions` makes a worksheet of the quiz
questions. A course is loaded only when it is in the owner's own list, because
upstream's store reads a course for anyone who holds its id. The browser tests store a course, export it both ways and check that a course
of another visitor is refused.

```env
# .env.local, on top of the two variables above
OPENMAIC_AGENT_RUNTIME_ENABLED=true
ZHEXU_DELIVERABLES_ENABLED=true      # read at request time, no rebuild
```

Off by default: without the switch the agent has no handout tools and the
endpoints answer 404.

"My files" (`zhexu/files-page.tsx`, a rail page at `/workspace?view=zhexu-files`)
lists what was delivered to the owner in every conversation, handouts and
annotated images alike, with the same private download links the cards use. It
stores nothing: the list is read from the session materials that carry the
extension's provenance, through the store's owner-only listing of
conversations, newest first and at most fifty conversations at a time. It is
available when either switch is on and says so when neither is.

| File in `zhexu/deliverables/` | What it holds                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `contract.ts`                 | the source schema, formats, tool names and links; shared by server and browser   |
| `tools.ts`                    | `create_deliverable`, `create_course_handout`, `export_deliverable`, `read_deliverable`, `verify_deliverable` |
| `course-source.ts`            | turns a saved course into the text of a handout or a worksheet                   |
| `course-store.ts`             | loads a course only if it is in the owner's own list                             |
| `render.ts`                   | draws the pages (`@napi-rs/canvas`), builds the PDF (`pdf-lib`) and ZIP (`jszip`)  |
| `storage.ts`                  | saves a file as a session material and records what it was made from             |
| `latest-answer.ts`            | picks the answer "export the last answer" refers to                              |
| `routes.ts`                   | the download, the verification and the "My files" listing endpoint              |
| `library.ts`                  | groups the delivered files of a conversation into entries for "My files"         |
| `card.tsx`                    | the card in the conversation                                                     |
| `enabled.ts`                  | the switch                                                                       |

How it keeps its promises:

- A handout is stored as materials of the session: one per file, plus a JSON
  record of the source text and the files made from it. No new table and no
  schema change; a file's origin goes into the material's existing `sourceUrl`.
- The same source is rendered once. A repeated export returns the saved files
  after checking their bytes against the recorded SHA-256.
- A link is only handed out for bytes that are stored exactly as written. When a
  file is missing, the intact ones stay available and the state is `partial`.
- A failure half way keeps what was written and the exact source, so the next
  export finishes from that source and the model is not asked to write it again.
- Tools and endpoints check that the session belongs to the requesting owner and
  answer "not found" otherwise. The download endpoint serves only PDF, PNG and
  ZIP files that a handout wrote, as attachments that are never cached.
- No model is called by any of this; a run renders at most two handouts.

Text fonts are the ones upstream ships for its video export
(`public/vendor/video-export/fonts/`), with its KaTeX fonts as the fallback for
Greek letters and common math signs. The handwriting face is Long Cang (SIL OFL
1.1) in `public/extensions/zhexu/fonts/`.

Not covered: subscript and superscript digits such as ₁ (no shipped font has
them), formulas (text is drawn as written, LaTeX is not typeset), tables and
images. Text that needs more than sixteen pages is refused, not cut.

## Image annotations (ZHEXU)

With the switch on, the agent can look at a PNG, JPEG or WebP image the user
attached and put numbered labels on it. The result is an A4 PNG and PDF: the
image, a numbered marker with an arrow at every point and the labels listed
underneath. The original image is never changed, and no image model is called.

```env
ZHEXU_IMAGE_ANNOTATIONS_ENABLED=true   # read at request time, no rebuild
```

| File in `zhexu/annotations/` | What it holds                                                          |
| ---------------------------- | ---------------------------------------------------------------------- |
| `contract.ts`                | point and crop schemas, and the mapping from a view back to the original |
| `render.ts`                  | the bounded preview shown to the model, and the annotated A4 page      |
| `tools.ts`                   | `view_material_image` and `annotate_image`                              |
| `enabled.ts`                 | the switch                                                             |

How it works:

- `view_material_image` returns a JPEG preview of the whole image or of one
  crop, at most 32 KB and four looks per run, with a `viewId`.
- `annotate_image` only accepts an image the model has looked at in this run.
  Points given relative to a crop are mapped back to the original through the
  rectangle that was actually cut. Points are refused when the image's bytes
  changed after the look.
- The files are saved and served like a handout's (same storage, same download
  endpoint, same card), and the same annotation is drawn only once. The card
  reminds the reader to check the positions.
- The tools are offered only to a model the built-in registry declares
  vision-capable. Upstream sends tool-result images to no other model, and
  `openmaic.yml` cannot declare a custom OpenAI-compatible model as
  vision-capable, so such a model does not get the tools.

Not ported from the private edition: the dialog in which the user moves and
edits the labels and saves a new revision, searching and importing images from
the web, and source attribution.

## Theme

`zhexu/theme.css` overrides three groups of custom properties that upstream
already reads: the semantic tokens of `app/globals.css`, Tailwind's violet and
purple scales (the upstream accent in about a thousand utility classes), and the
workspace shell's `--ws-*` palette.

Upstream also writes its accent as literal colours in three stylesheets. Those
cannot be re-themed through custom properties, so
`zhexu/scripts/sync-upstream-accent.mjs` finds each such declaration and repeats
it under the brand scope in `zhexu/theme-upstream-literals.css`, with the literal
replaced by the matching step of the remapped scale.

After rebasing on upstream:

```bash
node extensions/zhexu/scripts/sync-upstream-accent.mjs
```

`tests/extensions/deployment-extensions.test.ts` fails when the generated file is
out of date.

## Not covered yet

- Literal colours in upstream TSX (inline styles, share images, video export).
- The classic home page (`app/classic-home.tsx`), which hard-codes the OpenMAIC
  logo; the brand shows in the workbench shell.
- Upstream locale strings that name the product ("Welcome to OpenMAIC" in the
  first-run tour, "About OpenMAIC" in the account menu) and the favicon.
- A real model: every run so far, on a development machine and in CI (a
  production build and the Docker image, see `zhexu/e2e/README.md`), used a
  scripted stand-in that calls the tools with fixed content. How a real model
  uses the tools, and what it writes into a handout, is not checked.

## Add another extension

1. Add the id to `DEPLOYMENT_EXTENSION_IDS` in `config.ts`.
2. Create `extensions/<id>/` with a component that wraps its children in the
   providers it needs, and register it in `index.tsx` and `metadata.ts`.
3. Scope every style rule to `html[data-brand='<id>']`.
