# 折序 ZHEXU showcase page

One static page that presents the project: what it does, real screenshots, what is
available now and what is planned, and how to run it. There is no build step and
the page loads nothing from another host, so it can be served from any static
host or opened straight from disk.

It is Chinese by default with an English version, and follows the system colour
scheme until the visitor picks one.

## Preview

```bash
node extensions/zhexu/site/tools/serve.mjs
```

Then open <http://localhost:4173/>. Add `?lang=en` or `?lang=zh`, and
`?theme=dark` or `?theme=light`, to link to a particular state.

## Publish

Copy these to the web root of a static host:

```
index.html
site.css
site.js
site.strings.js
assets/
```

`tools/` and this file are not part of the page.

## When the repository is public

Set its address on the first line of the markup:

```html
<html lang="zh-CN" data-repo="https://github.com/<owner>/<repo>">
```

The "source coming soon" button becomes a link to the repository, the clone
command shows the real address and the license link points at the repository's
own `LICENSE`. Until then the page says that the source is not public yet, and
the license link goes to upstream's.

The app has its own copy of this link: `ZHEXU_LINKS.source` in
`extensions/zhexu/brand.ts`.

## Text

Chinese is written in `index.html`, so a visitor without JavaScript gets a
complete page. English is in `site.strings.js`. An element is translated when it
carries a key:

```html
<p data-i18n="hero.note">MIT 许可，基于 OpenMAIC 构建。</p>
<img alt="…" data-i18n-attr="alt:screens.home.alt" />
```

`tests/extensions/zhexu-site.test.ts` fails when a key has no English, when an
English string is no longer used, or when the page refers to a file that is not
there.

## Design

The design lives in a Figma file. The custom properties at the top of `site.css`
carry the same names as its variables (`color/bg/page` is `--zx-bg-page`,
`space/32` is `--zx-space-32`), in a light and a dark set. Change a value in both
places.

- Layout is drawn at 375 and 1440 wide. Type sizes and section spacing run
  between the two; below 860 the two-column rows stack.
- The strip under the headline is six leaves folded like a concertina book. Each
  leaf turns 14° about one vertical edge, alternating, under one shared
  perspective. It opens once when the page loads, and stays open for visitors who
  ask for reduced motion. On a narrow window it scrolls sideways.
- Latin text is set in Geist, which is bundled (`assets/fonts/`, SIL Open Font
  License, see `OFL.txt`). Chinese uses the fonts of the visitor's system; the
  design file uses Noto Sans SC, so line breaks can differ slightly from it.

## Screenshots

`assets/shots/` holds captures of the running product, 2400×1500. To retake them,
start the app with the extension enabled (see `extensions/README.md`) and run:

```bash
node extensions/zhexu/site/tools/capture-screenshots.mjs
```

The script drives an installed Edge or Chrome with a fresh profile and opens the
bundled guide course. It calls no model.
