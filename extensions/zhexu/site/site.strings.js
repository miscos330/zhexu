/*
 * Strings of the showcase page.
 *
 * Chinese is written in index.html, which is what a visitor without JavaScript gets.
 * `en` holds the English for every key the page marks with `data-i18n` or
 * `data-i18n-attr`; `zh` only holds the Chinese strings the page does not contain
 * when it loads, because they belong to a state it is not in yet.
 */
window.ZX_STRINGS = {
  zh: {
    'cta.source': '查看源码',
    'copy.done': '已复制',
    'copy.failed': '复制失败，请手动选择',
    'theme.toDark': '切换到深色模式',
    'theme.toLight': '切换到浅色模式',
  },
  en: {
    'meta.title': 'ZHEXU: one sentence, unfolded into a lesson',
    'a11y.skip': 'Skip to content',
    'a11y.nav': 'On this page',
    'a11y.links': 'Related links',
    'theme.toDark': 'Switch to dark mode',
    'theme.toLight': 'Switch to light mode',

    'nav.screens': 'Screens',
    'nav.features': 'Features',
    'nav.open': 'Open source',
    'nav.run': 'Run locally',

    'hero.title.1': 'One sentence,',
    'hero.title.2': 'unfolded into a lesson.',
    'hero.lead':
      'ZHEXU is an open-source AI classroom. Say what you want to learn: it plans an outline, builds the pages, then an AI teacher explains them and AI classmates discuss them with you.',
    'cta.source': 'View source',
    'cta.source.pending': 'Source coming soon',
    'cta.run': 'Run it locally',
    'hero.note': 'MIT licensed. Built on OpenMAIC.',

    'fold.label': 'How one sentence unfolds into a lesson, in six steps',
    'fold.sentence.label': 'Your sentence',
    'fold.sentence.text': 'Teach me photosynthesis, for eighth graders',
    'fold.outline.label': 'Outline',
    'fold.outline.1': 'Why leaves are green',
    'fold.outline.2': 'Light reactions: light into energy',
    'fold.outline.3': 'Dark reactions: energy into sugar',
    'fold.outline.4': 'Quiz',
    'fold.slide.label': 'Slide',
    'fold.slide.title': 'Light reactions',
    'fold.slide.body': 'Thylakoid membranes absorb light, split water and release oxygen.',
    'fold.board.label': 'Whiteboard',
    'fold.board.body': 'The teacher writes the equation while explaining it.',
    'fold.quiz.label': 'Quiz',
    'fold.quiz.question': 'Where do the light reactions happen?',
    'fold.quiz.option1': 'Thylakoid membrane',
    'fold.quiz.option2': 'Stroma',
    'fold.quiz.option3': 'Cell wall',
    'fold.talk.label': 'Discussion',
    'fold.talk.teacher': 'Teacher: Why do leaves turn yellow in autumn?',
    'fold.talk.classmate': 'Classmate: Is there less chlorophyll?',
    'fold.talk.you': 'You can join in…',

    'screens.title': 'These are the real screens',
    'screens.sub':
      'Captured from ZHEXU running locally. The course is the built-in starter course.',
    'screens.classroom':
      'In class: the page on top, the teacher’s narration below, AI classmates on the right.',
    'screens.classroom.alt':
      'The ZHEXU classroom: a slide in the middle, the teacher’s narration under it and AI classmates on the right.',
    'screens.home': 'Start: write what you want to learn, and attach material if you have it.',
    'screens.home.alt': 'The ZHEXU home page: a box for writing what you want to learn.',
    'screens.finished': 'After a lesson: take the quiz, or start over.',
    'screens.finished.alt': 'The dialog shown after a lesson, offering the quiz or a fresh start.',
    'screens.dark': 'Dark mode.',
    'screens.dark.alt': 'The classroom in dark mode.',

    'syllabus.title': 'What is in a lesson',
    'syllabus.class.label': 'In class',
    'syllabus.class.teacher.term': 'AI teacher',
    'syllabus.class.teacher.desc':
      'Explains page by page, writes formulas and draws on the whiteboard, and reads aloud.',
    'syllabus.class.classmates.term': 'AI classmates',
    'syllabus.class.classmates.desc': 'They ask questions and argue. You can join in at any time.',
    'syllabus.class.ask.term': 'Ask the teacher',
    'syllabus.class.ask.desc':
      'Type or use the microphone. The teacher answers with a slide or the whiteboard.',
    'syllabus.pages.label': 'Pages',
    'syllabus.pages.kinds.term': 'Four kinds of page',
    'syllabus.pages.kinds.desc':
      'Slides, quizzes, hands-on interactive experiments and project-based learning.',
    'syllabus.prepare.label': 'Preparing',
    'syllabus.prepare.start.term': 'Start from one sentence',
    'syllabus.prepare.start.desc':
      'Write a topic, or attach a PDF or other material, and get a lesson in minutes.',
    'syllabus.prepare.revise.term': 'Revise by chatting',
    'syllabus.prepare.revise.desc':
      'Say “make page 2 simpler” in the chat and the AI changes it. You can also edit pages directly.',
    'syllabus.prepare.sources.term': 'Knowledge base and web search',
    'syllabus.prepare.sources.desc':
      'Let a lesson draw on your own library, or look up current information online.',
    'syllabus.take.label': 'Taking it with you',
    'syllabus.take.export.term': 'Export',
    'syllabus.take.export.desc':
      'An editable PPTX, a single HTML file that plays offline, or a ZIP of the whole lesson.',
    'syllabus.host.label': 'Hosting',
    'syllabus.host.self.term': 'Self-hosted',
    'syllabus.host.self.desc': 'Node.js with PostgreSQL, or Docker.',
    'syllabus.host.models.term': 'Your choice of model',
    'syllabus.host.models.desc':
      'OpenAI, Anthropic, Gemini, DeepSeek, Qwen, Ollama and more. Keys stay on your server.',
    'syllabus.host.locales.term': '12 interface languages',
    'syllabus.host.locales.desc':
      'English, Simplified and Traditional Chinese, Japanese, Korean and others.',

    'open.title': 'Built on OpenMAIC',
    'open.sub':
      'ZHEXU is built on OpenMAIC, open-sourced by the THU-MAIC team under the MIT license. The classroom, the pages and the exports come from upstream. ZHEXU adds its own brand, theme and extensions on top, and sends general improvements back upstream.',
    'open.now.label': 'Available now',
    'open.now.classroom.term': 'Classroom',
    'open.now.classroom.desc': 'Everything upstream OpenMAIC does.',
    'open.now.brand.term': 'Brand and theme',
    'open.now.brand.desc': 'The ZHEXU mark, colours and dark mode.',
    'open.now.layer.term': 'Extension layer',
    'open.now.layer.desc':
      'New features are added without editing upstream core code, so upgrades stay easy.',
    'open.now.handouts.term': 'A4 handouts',
    'open.now.handouts.desc':
      'The assistant delivers an answer as an A4 PDF and page images, in a handwriting font if you like. Off by default.',
    'open.now.course.term': 'Course handouts',
    'open.now.course.desc':
      'Export a saved course as an A4 handout or a worksheet, with the text taken from the course as it is. Shares the switch of A4 handouts.',
    'open.now.annotations.term': 'Image annotations',
    'open.now.annotations.desc':
      'The assistant adds numbered notes to an image you attach and exports a PNG and a PDF; the original is not changed. Off by default.',
    'open.now.files.term': 'My files',
    'open.now.files.desc':
      'One page that lists the handouts and annotated images delivered in your conversations.',
    'open.now.formulas.term': 'Typeset formulas',
    'open.now.formulas.desc':
      'LaTeX in a handout and the formulas of a course are typeset, with the same layout and fonts as on a slide.',
    'open.now.tables.term': 'Tables',
    'open.now.tables.desc':
      'Tables in a handout and in a course are drawn ruled, with a shaded header and long cells wrapped.',
    'open.next.label': 'Planned',
    'open.next.pictures.term': 'Pictures',
    'open.next.pictures.desc':
      'A course’s pictures are left out of a handout for now; the plan is to place them.',

    'run.title': 'Run it on your own machine',
    'run.sub': 'You need Node.js 22.19 or later, pnpm 10 and PostgreSQL 16.',
    'run.get.label': 'Get the source',
    'run.get.placeholder': '<repo-url>',
    'run.get.note': 'The real address goes here once the repository is public.',
    'run.configure.label': 'Configure',
    'run.configure.note':
      'Put your model key and database address in .env.local, then add these three lines:',
    'run.start.label': 'Start',
    'run.start.note':
      'pnpm db:up starts a development database in Docker; skip it if you already have PostgreSQL. Then open http://localhost:3000.',
    'copy.idle': 'Copy',
    'copy.done': 'Copied',
    'copy.failed': 'Couldn’t copy. Select the text instead.',

    'footer.note': 'ZHEXU is released under the MIT license. Built on THU-MAIC/OpenMAIC.',
    'footer.upstream': 'OpenMAIC upstream',
    'footer.releases': 'Releases',
    'footer.license': 'License',
  },
};
