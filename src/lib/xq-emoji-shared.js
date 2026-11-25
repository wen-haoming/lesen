/* 雪球 [赞] 等表情：正文里保留 token，展示时用 CDN 图（Twemoji / 雪球原图） */
(function () {
  'use strict';

  const TW_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/';
  const NAME_TO_CP = {
    '赞': '1f44d', '很赞': '1f44d', '微笑': '1f642', '呵呵': '1f604', '汗': '1f605', '哭': '1f622',
    '生气': '1f620', '怒': '1f620', '偷笑': '1f60f', '鄙视': '1f612', '鼓掌': '1f44f',
    '得意': '1f60e', '问号': '2753', '鬼脸': '1f61c', '献花': '1f49a', '拜神': '1f64f'
  };

  const TOKEN_RE = /\[:img:([^\]]+):\]|\[:name:([^\]]+):\]/g;

  function bracketName(alt) {
    const m = String(alt || '').trim().match(/^\[([^\]]+)\]$/);
    return m ? m[1] : '';
  }

  function faceImgUrl(name) {
    const cp = NAME_TO_CP[name];
    return cp ? TW_BASE + cp + '.png' : '';
  }

  function faceLabelText(name) {
    const n = String(name || '').trim();
    return n ? '[表情：' + n + ']' : '[表情]';
  }

  function appendFaceFallback(parent, name) {
    const span = document.createElement('span');
    span.className = 'xq-face-fallback';
    span.textContent = faceLabelText(name);
    parent.appendChild(span);
  }

  function appendFaceImage(parent, url, name) {
    const label = String(name || '').trim();
    const el = document.createElement('img');
    el.className = 'xq-face';
    el.src = url;
    el.alt = faceLabelText(label);
    el.width = 16;
    el.height = 16;
    el.loading = 'lazy';
    el.decoding = 'async';
    el.addEventListener('error', () => {
      const span = document.createElement('span');
      span.className = 'xq-face-fallback';
      span.textContent = faceLabelText(label);
      el.replaceWith(span);
    }, { once: true });
    parent.appendChild(el);
  }

  function imgToken(src, alt) {
    const url = String(src || '').trim();
    if (/^https?:\/\//i.test(url)) return '[:img:' + url + ':]';
    const name = bracketName(alt) || String(alt || '').trim();
    if (name) return '[:name:' + name + ':]';
    return '';
  }

  function stripXueqiuHtml(input) {
    if (!input) return '';
    const raw = String(input);
    const tag = 'im' + 'g';
    try {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      const root = doc.body;
      Array.from(root.querySelectorAll(tag)).forEach((node) => {
        const token = imgToken(node.getAttribute('src'), node.getAttribute('alt') || node.getAttribute('title'));
        node.replaceWith(doc.createTextNode(token ? ' ' + token + ' ' : ''));
      });
      // 只合并同一行内的空白，保留原文换行与段落（多语言 / 长推文可读）
      return (root.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\r\n?/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } catch (e) {
      const open = '<' + tag;
      return raw
        .replace(new RegExp(open + '[^>]*\\bsrc="([^"]+)"[^>]*\\balt="(\\[[^"]+\\])"[^>]*>', 'gi'),
          (_, src, alt) => ' ' + imgToken(src, alt) + ' ')
        .replace(new RegExp(open + '[^>]*\\balt="(\\[[^"]+\\])"[^>]*\\bsrc="([^"]+)"[^>]*>', 'gi'),
          (_, alt, src) => ' ' + imgToken(src, alt) + ' ')
        .replace(new RegExp(open + '[^>]*\\balt="(\\[[^"]+\\])"[^>]*>', 'gi'),
          (_, alt) => ' ' + imgToken('', alt) + ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\u00a0/g, ' ')
        .replace(/\r\n?/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
  }

  function appendRichText(parent, text, onPlainSlice) {
    const value = String(text || '');
    if (!value) return;
    let last = 0;
    let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(value)) !== null) {
      if (m.index > last && onPlainSlice) onPlainSlice(parent, value.slice(last, m.index));
      const name = String(m[2] || '').trim();
      const url = m[1] ? String(m[1]).trim() : faceImgUrl(name);
      if (url) {
        appendFaceImage(parent, url, name);
      } else if (name) {
        appendFaceFallback(parent, name);
      } else if (m[1] && onPlainSlice) {
        onPlainSlice(parent, '[表情]');
      }
      last = m.index + m[0].length;
    }
    if (last < value.length && onPlainSlice) onPlainSlice(parent, value.slice(last));
  }

  // MAIN-world reinjection must preserve the existing non-configurable global.
  if (!Object.prototype.hasOwnProperty.call(globalThis, 'XQ_EMOJI')) {
    Object.defineProperty(globalThis, 'XQ_EMOJI', {
      value: Object.freeze({ stripXueqiuHtml, appendRichText, faceImgUrl }),
      writable: false,
      configurable: false
    });
  }
})();
