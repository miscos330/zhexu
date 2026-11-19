# Changelog of the ZHEXU edition

What changes in this repository on top of upstream OpenMAIC. Upstream's own changes are in the [CHANGELOG.md](/CHANGELOG.md) at the root, which stays upstream's.

A release of this edition is tagged `zhexu-v<version>`. The plain `v<version>` tags belong to upstream's releases, so this edition does not use them. Each entry names the upstream commit it is built on.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0-rc.1] - 2026-11-19

The first release candidate for 0.1.0, the first release of this edition. It is a candidate because no run has used a real model yet; see "How it was checked". Built on upstream `main` at `a985fc4d`, which is 1.5.0-rc.3 and the changes upstream has made since.

### Features

- Extension layer: what a deployment adds lives under `extensions/<id>/` and is selected with `NEXT_PUBLIC_DEPLOYMENT_EXTENSION`. An extension can change the product name and logo, the colours, the page title, the pages and menu entries of the workspace shell, and can add agent tools, the cards of those tools and HTTP endpoints of its own. With no extension selected the app is exactly upstream OpenMAIC.
- Brand and theme: the ZHEXU mark and colours in light and dark mode, and an about page in the rail.
- A4 handouts (`ZHEXU_DELIVERABLES_ENABLED`): the assistant hands an answer over as an A4 PDF, an image of the first page and, for more than one page, a ZIP of every page. `style=handwriting` sets the body in a Chinese handwriting face. The conversation shows a card with a preview, the download links and a button that re-checks the saved files.
- Course handouts, under the same switch: a saved course exported as a handout with what is written on each page, the narration and the quiz questions in page order, and the answers on a page of their own. The text is taken from the course as it is saved and no model rewrites it. The quiz questions alone make a worksheet, with a line for the name, class and date, room to write under a question without options, and the answers on their own page.
- Image annotations (`ZHEXU_IMAGE_ANNOTATIONS_ENABLED`): the assistant looks at a PNG, JPEG or WebP image attached to the conversation and puts numbered labels on it, delivered as an A4 PNG and PDF. The original image is not changed.
- My files: a page in the rail that lists the handouts and annotated images delivered in the owner's conversations, with their download links. It is available when either switch is on.
- Docker: the image includes the extension when `NEXT_PUBLIC_DEPLOYMENT_EXTENSION=zhexu` and `NEXT_PUBLIC_WORKBENCH_ENABLED=true` are passed as build arguments.
- Showcase page: a static page with no build step under `extensions/zhexu/site/`, published to GitHub Pages.

The handout, annotation and file features are off until their switch is set. Nothing is added to the database schema: delivered files are stored as materials of the conversation.

### How it was checked

- 135 unit tests under `tests/extensions/`.
- 7 browser tests under `extensions/zhexu/e2e/`, which CI runs against a production build and against the Docker image. They cover a handout, a course handout, a worksheet, an annotated image, the "My files" page, and that a course of another visitor is refused.
- In every one of these runs a scripted stand-in took the place of the model and called the tools with fixed content. No run has used a real model, so how a real model uses the tools, and what it writes into a handout, is not checked.

### Known limits

- Formulas in a handout are printed as their LaTeX source. Tables, images and subscript or superscript digits such as ₁ are not drawn.
- A handout has at most sixteen pages. Longer text is refused, not cut; a course can be exported as a range of pages.
- A course handout takes text from slides and quizzes. An interactive or project-based page gives only its title.
- The annotation tools are offered only to a model that upstream's built-in registry declares vision-capable.
- "My files" reads at most fifty conversations at a time.
- The brand does not reach the classic home page, the favicon, and upstream strings that name the product.

The full list is in [`extensions/README.md`](/extensions/README.md#not-covered-yet).

### Upstream files touched

`app/layout.tsx`, `lib/server/agent-runtime/runner.ts`, `components/workbench/chat/action-cluster.tsx` and `.env.example`, each by a few lines. `Dockerfile` and `docker-compose.yml` take one more build argument. The issue forms under `.github/ISSUE_TEMPLATE/` ask about this repository.
