# End-to-end tests of the ZHEXU extension

Two browser tests drive the real app through what the extension adds:

| Test                 | What it does                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `handout.spec.ts`    | asks for a handout on the home page, waits for the card, downloads every file it links          |
| `annotation.spec.ts` | attaches an image, asks for annotations, waits for the card, downloads the PNG and the PDF      |

The model is a scripted stand-in (`mock-model.mjs`): it answers a request by
calling the extension's tools the way a model would, with fixed content. What
the tests exercise is everything after that call, which is all real: the tools,
the renderer with its native canvas package and fonts, the material store in
PostgreSQL, the card in the conversation and the download route. They say
nothing about how a real model uses the tools.

## Run

The app needs PostgreSQL, as it always does (`pnpm db:up`, with `DATABASE_URL`
in `.env.local`).

```bash
pnpm exec playwright test -c extensions/zhexu/e2e/playwright.config.ts
```

This starts the stand-in model on port 11999 and the app on port 3210 with the
extension and its tools switched on (see the `env` block in
`playwright.config.ts`), runs the tests and stops both. Locally the app runs
under `next dev`; in CI it is built first and started with `next start`.

- `ZHEXU_E2E_CHANNEL=chrome` (or `msedge`) drives an installed browser when
  Playwright's own Chromium is not downloaded.
- `ZHEXU_E2E_BASE_URL=http://localhost:3210` points the tests at an app that is
  already running, for example the Docker image. Only the stand-in model is
  started then.

## In CI

`.github/workflows/zhexu-ci.yml` runs them twice: against a production build
(`next start`), and against the Docker image built from the `Dockerfile`, which
is how the handouts are known to render on Alpine with the image's own copy of
the fonts.
