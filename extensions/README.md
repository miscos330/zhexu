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
public/extensions/zhexu/   brand assets and their provenance
tests/extensions/          tests
```

The only upstream files touched are `app/layout.tsx` (two imports, the
`data-brand` attribute, the `DeploymentExtensions` wrapper and one spread in
`metadata`) and `.env.example` (one section at the end).

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
- Docker builds: `Dockerfile` and `docker-compose.yml` pass each `NEXT_PUBLIC_*`
  value as a build argument, and `NEXT_PUBLIC_DEPLOYMENT_EXTENSION` is not among
  them yet.

## Add another extension

1. Add the id to `DEPLOYMENT_EXTENSION_IDS` in `config.ts`.
2. Create `extensions/<id>/` with a component that wraps its children in the
   providers it needs, and register it in `index.tsx` and `metadata.ts`.
3. Scope every style rule to `html[data-brand='<id>']`.
