/*
 * 折序 ZHEXU showcase page: language, theme, copy buttons and the repository link.
 *
 * The page works without this file: it stays in Chinese, follows the system theme
 * and shows the "source coming soon" state. It is loaded in <head> without `defer`
 * so that a stored theme and language are on <html> before the first paint.
 */
(() => {
  const root = document.documentElement;
  const strings = window.ZX_STRINGS;
  const STORE = { lang: 'zx-lang', theme: 'zx-theme' };
  /** The language button names the other language, in that language. */
  const LANG_TOGGLE = {
    zh: { text: 'EN', lang: 'en', label: 'Switch to English' },
    en: { text: '中文', lang: 'zh-CN', label: '切换到中文' },
  };

  function read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function write(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage is blocked: the choice lasts for this visit only.
    }
  }

  const pick = (value, allowed) => (allowed.includes(value) ? value : null);
  const query = new URLSearchParams(window.location.search);

  // `?lang=en` and `?theme=dark` make a state linkable; a stored choice comes next.
  let lang =
    pick(query.get('lang'), ['zh', 'en']) ||
    pick(read(STORE.lang), ['zh', 'en']) ||
    (/^zh\b/i.test(navigator.language || 'zh') ? 'zh' : 'en');
  let theme =
    pick(query.get('theme'), ['light', 'dark']) || pick(read(STORE.theme), ['light', 'dark']);

  root.lang = lang === 'zh' ? 'zh-CN' : 'en';
  if (theme) root.dataset.theme = theme;
  root.classList.add('zx-js');
  // The opening animation needs a registered custom property (see site.css).
  if (window.CSS && 'registerProperty' in window.CSS) root.classList.add('zx-can-unfold');

  /** The Chinese of the page as written, kept so the page can switch back to it. */
  const original = new Map();
  const tidy = (value) => value.replace(/\s+/g, ' ').trim();

  function translate(key) {
    if (lang === 'en') return strings.en[key];
    return original.has(key) ? original.get(key) : strings.zh[key];
  }

  /** `data-i18n-attr="alt:some.key; title:other.key"` as [attribute, key] pairs. */
  function attributePairs(element) {
    return element.dataset.i18nAttr
      .split(';')
      .map((pair) => pair.split(':').map((part) => part.trim()));
  }

  function remember() {
    for (const element of document.querySelectorAll('[data-i18n]')) {
      original.set(element.dataset.i18n, tidy(element.textContent));
    }
    for (const element of document.querySelectorAll('[data-i18n-attr]')) {
      for (const [attribute, key] of attributePairs(element)) {
        original.set(key, element.getAttribute(attribute));
      }
    }
  }

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const activeTheme = () => theme || (darkQuery.matches ? 'dark' : 'light');

  function renderTheme() {
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    document
      .getElementById('zx-theme')
      .setAttribute(
        'aria-label',
        translate(activeTheme() === 'dark' ? 'theme.toLight' : 'theme.toDark'),
      );
    if (theme) {
      // A chosen theme overrides the system one, so the browser chrome follows it too.
      const color = getComputedStyle(document.body).backgroundColor;
      for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
        meta.content = color;
      }
    }
  }

  function render() {
    root.lang = lang === 'zh' ? 'zh-CN' : 'en';
    for (const element of document.querySelectorAll('[data-i18n]')) {
      const value = translate(element.dataset.i18n);
      if (value !== undefined) element.textContent = value;
    }
    for (const element of document.querySelectorAll('[data-i18n-attr]')) {
      for (const [attribute, key] of attributePairs(element)) {
        const value = translate(key);
        if (value !== undefined) element.setAttribute(attribute, value);
      }
    }
    const toggle = LANG_TOGGLE[lang];
    const button = document.getElementById('zx-lang');
    button.textContent = toggle.text;
    button.lang = toggle.lang;
    button.setAttribute('aria-label', toggle.label);
    renderTheme();
  }

  /** With `data-repo` set on <html>, the source button, clone command, license and releases links go live. */
  function wireRepository() {
    const repo = (root.dataset.repo || '')
      .trim()
      .replace(/\/+$/, '')
      .replace(/\.git$/, '');
    if (!/^https:\/\/\S+$/.test(repo)) return;

    const source = document.getElementById('zx-source');
    source.href = repo;
    source.rel = 'noopener';
    source.removeAttribute('role');
    source.removeAttribute('aria-disabled');
    source.dataset.i18n = 'cta.source';

    const address = document.getElementById('zx-repo-url');
    address.removeAttribute('data-i18n');
    address.textContent = `${repo}.git`;
    document.getElementById('zx-repo-note').hidden = true;
    // HEAD is the repository's default branch, whatever it is called.
    document.getElementById('zx-license').href = `${repo}/blob/HEAD/LICENSE`;
    // Releases exist only where the source does, so the link stays hidden without it.
    const releases = document.getElementById('zx-releases');
    releases.href = `${repo}/releases`;
    releases.hidden = false;
  }

  /** A strip or code block that scrolls sideways must be reachable from the keyboard. */
  function syncScrollable() {
    for (const element of document.querySelectorAll('.zx-fold__scroller, .zx-code__pre')) {
      if (element.scrollWidth > element.clientWidth + 1) element.tabIndex = 0;
      else element.removeAttribute('tabindex');
    }
  }

  async function copy(value) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // Refused (an embedded frame, a denied permission): try the older way below.
      }
    }
    // Pages opened from disk or over plain HTTP have no clipboard API at all.
    const area = document.createElement('textarea');
    area.value = value;
    area.readOnly = true;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) throw new Error('The browser refused to copy');
  }

  const resetTimers = new WeakMap();

  function setCopyState(button, state) {
    window.clearTimeout(resetTimers.get(button));
    if (state === 'idle') delete button.dataset.state;
    else button.dataset.state = state;
    button.dataset.i18n = `copy.${state}`;
    button.textContent = translate(button.dataset.i18n);
    if (state === 'idle') return;
    document.getElementById('zx-status').textContent = button.textContent;
    resetTimers.set(
      button,
      window.setTimeout(() => setCopyState(button, 'idle'), state === 'done' ? 2000 : 5000),
    );
  }

  async function onCopy(button) {
    const code = button.parentElement.querySelector('code');
    try {
      await copy(code.textContent);
      setCopyState(button, 'done');
    } catch {
      // Select the command, so that the keyboard shortcut still copies it.
      window.getSelection().selectAllChildren(code);
      setCopyState(button, 'failed');
    }
  }

  function start() {
    remember();
    wireRepository();
    render();
    syncScrollable();

    document.getElementById('zx-lang').addEventListener('click', () => {
      lang = lang === 'zh' ? 'en' : 'zh';
      write(STORE.lang, lang);
      render();
      syncScrollable();
    });
    document.getElementById('zx-theme').addEventListener('click', () => {
      theme = activeTheme() === 'dark' ? 'light' : 'dark';
      write(STORE.theme, theme);
      renderTheme();
    });
    for (const button of document.querySelectorAll('.zx-copy')) {
      button.addEventListener('click', () => onCopy(button));
    }

    darkQuery.addEventListener('change', renderTheme);
    window.addEventListener('resize', syncScrollable);
    document.querySelector('.zx-fold__scene').addEventListener('animationend', syncScrollable);
    if (document.fonts) document.fonts.ready.then(syncScrollable);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
