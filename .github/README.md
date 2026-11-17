# 折序 ZHEXU

**One sentence, unfolded into a lesson.**

ZHEXU is an open-source AI classroom. Say what you want to learn: it plans an outline, builds the pages, then an AI teacher explains them and AI classmates discuss them with you.

English | [简体中文](/.github/README-zh.md)

[![ZHEXU checks](https://github.com/miscos330/zhexu/actions/workflows/zhexu-ci.yml/badge.svg?branch=zhexu)](https://github.com/miscos330/zhexu/actions/workflows/zhexu-ci.yml)

![The ZHEXU classroom: a slide in the middle, the teacher's narration under it and AI classmates on the right](/extensions/zhexu/site/assets/shots/classroom-light.webp)

## Built on OpenMAIC

ZHEXU is a downstream edition of [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC), which the THU-MAIC team open-sourced under the MIT license. The classroom, the pages and the exports all come from upstream. This repository adds its own brand, theme and extensions on top. Improvements that are not specific to ZHEXU go back upstream instead of staying here.

The upstream README is kept unchanged at the root of this repository. [README.md](/README.md) describes everything the classroom can do, with all of its setup options.

## Status

This is an early edition. Nothing has been released yet.

Available now:

- **Classroom**: everything upstream OpenMAIC does.
- **Brand and theme**: the ZHEXU mark, colours and dark mode.
- **Extension layer**: new features live under [`extensions/`](/extensions/README.md) and are added with a few small hooks into upstream code, so upgrades stay easy.
- **A4 handouts**: the assistant hands an answer over as real files, an A4 PDF and page images, optionally in a Chinese handwriting face. [How it works](/extensions/README.md#a4-handouts-zhexu).
- **Image annotations**: the assistant looks at an image you attached and puts numbered labels on it, as an A4 PNG and PDF. The original image is kept unchanged. [How it works](/extensions/README.md#image-annotations-zhexu).

Both are off until their switch is set (`ZHEXU_DELIVERABLES_ENABLED`, `ZHEXU_IMAGE_ANNOTATIONS_ENABLED`). They are covered by tests and have run end to end on a development machine, in development mode and in a production build, with a scripted stand-in for the model. They have not been run with a real model yet.

| A handout in the handwriting face | An annotated image |
| --- | --- |
| ![A sample A4 handout page set in a Chinese handwriting face](/extensions/zhexu/site/assets/shots/sample-handout.webp) | ![A sample annotated image: a drawing with numbered markers and the labels listed under it](/extensions/zhexu/site/assets/shots/sample-annotation.webp) |

These two pages are real output of the renderer, made from test content.

Planned:

- **More finished documents**: editable Word documents, and a page that lists the files the assistant delivered.
- **Accounts and usage**: sign-up and sign-in, with a usage limit per person.
- **Skills that improve**: teaching skills that refine themselves from how they are used.

What the extension does not reach yet is listed in [`extensions/README.md`](/extensions/README.md#not-covered-yet).

## Run it locally

You need Node.js 22.19 or later, pnpm 10 and PostgreSQL 16.

```bash
git clone https://github.com/miscos330/zhexu.git zhexu
cd zhexu
pnpm install
cp .env.example .env.local            # API keys and server options
cp openmaic.example.yml openmaic.yml  # which models the server uses
pnpm db:up                            # a development PostgreSQL in Docker; skip it if you have one
```

In `.env.local`, set a model key and `DATABASE_URL`, then add the three lines that turn ZHEXU on:

```env
NEXT_PUBLIC_DEPLOYMENT_EXTENSION=zhexu
NEXT_PUBLIC_WORKBENCH_ENABLED=true
OPENMAIC_AGENT_RUNTIME_ENABLED=true
```

```bash
pnpm dev
```

Open <http://localhost:3000>. The brand and the extension's entries show in the workbench, which is why the last two lines are needed. Without `NEXT_PUBLIC_DEPLOYMENT_EXTENSION` the app is exactly upstream OpenMAIC.

Models, Docker and the other options are covered in the upstream [Quick Start](/README.md#-quick-start). Docker builds do not include the extension yet.

## What this repository adds

| Path | What it is |
| --- | --- |
| [`extensions/`](/extensions/README.md) | The extension layer: which extension is active, and how one changes the brand, the theme and the workspace shell |
| [`extensions/zhexu/`](/extensions/zhexu) | The ZHEXU extension: brand, theme, an about page, A4 handouts and image annotations |
| [`extensions/zhexu/site/`](/extensions/zhexu/site/README.md) | A static showcase page with no build step. Preview it with `node extensions/zhexu/site/tools/serve.mjs` |
| [`public/extensions/zhexu/`](/public/extensions/zhexu) | Brand assets and where they come from |
| [`tests/extensions/`](/tests/extensions) | Tests for all of the above |
| [`.github/workflows/zhexu-ci.yml`](/.github/workflows/zhexu-ci.yml) | The checks that run on this branch |

Four upstream files are touched, each by a few lines: `app/layout.tsx` mounts the extension, `lib/server/agent-runtime/runner.ts` adds the extension's tools to a run, `components/workbench/chat/action-cluster.tsx` shows its cards in the conversation, and `.env.example` documents the switches.

## Branches

- `zhexu` is the default branch and carries this edition.
- `main` mirrors upstream. Upstream changes are merged into `zhexu`, which is never rebased.

## Contributing

An improvement that is not specific to ZHEXU belongs upstream, where everyone gets it. OpenMAIC's [CONTRIBUTING.md](/CONTRIBUTING.md) says how. Changes to the extension, the theme or the showcase page are welcome here as pull requests against `zhexu`.

## License

MIT, the same as upstream. The original THU-MAIC copyright notice is kept. See [LICENSE](/LICENSE).
