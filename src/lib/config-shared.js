/* 共享配置：同时注入 MAIN 与 ISOLATED 两个 world，各自持有一份只读副本 */
(function () {
  'use strict';

  var TARGET = Object.freeze({
    userId: '1247347556',
    name: '大道无形我有型'
  });

  // 默认不预置任何信息源；用户自行添加雪球关注或 X 账号
  var DEFAULT_SOURCES = Object.freeze([]);

  var MSG_TAG = '__XQ_DADAO_V1__';

  function feedKey(entry) {
    var platform = String((entry && entry.platform) || 'xueqiu');
    var id = String((entry && entry.id) || '');
    return platform + ':' + id;
  }

  function parseFeedKey(key) {
    var raw = String(key || '');
    var i = raw.indexOf(':');
    if (i <= 0) return { platform: 'xueqiu', id: raw.replace(/^\d+$/, raw) || '' };
    return { platform: raw.slice(0, i), id: raw.slice(i + 1) };
  }

  var LIMIT = Object.freeze({
    posts: 1000,
    titleChars: 90,
    // 与 X 路径对齐：保留引用/回复上下文，避免 160 字截断破坏嵌套展示
    summaryChars: 1600
  });

  var XQ_AVATAR_DEFAULT = 'https://xavatar.imedao.com';

  // 扩展页 CSP 只允许 https 图片；雪球接口偶发返回 http:// 或协议相对路径，统一升级。
  function forceHttps(value) {
    var s = String(value || '').trim();
    if (/^http:\/\//i.test(s)) return 'https://' + s.slice(7);
    if (s.indexOf('//') === 0) return 'https:' + s;
    if (!/^https:\/\//i.test(s)) return 'https://' + s.replace(/^\/+/, '');
    return s;
  }

  function isPackagedAssetPath(path) {
    return /^(?:\.\.?\/|\/)?(?:fixtures|icons)\//i.test(String(path || '').trim());
  }

  function packagedAssetUrl(path) {
    return ('/' + String(path).trim().replace(/^(?:\.\.?\/)+/, '').replace(/^\//, '')).slice(0, 500);
  }

  // 雪球常返回逗号拼接多档头像路径，整串不能当 img src
  function pickXueqiuAvatarPart(raw) {
    var parts = String(raw || '')
      .split(',')
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0];
    for (var i = 0; i < parts.length; i++) {
      if (/!\d+x\d+\.[a-z0-9]+$/i.test(parts[i])) return parts[i];
    }
    return parts[0];
  }

  function absoluteAvatarHost(raw) {
    var parts = String(raw || '').split(',');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (/^(?:https?:)?\/\//i.test(part)) {
        try {
          return new URL(forceHttps(part)).origin;
        } catch (e) {
          return XQ_AVATAR_DEFAULT;
        }
      }
    }
    return XQ_AVATAR_DEFAULT;
  }

  function resolveXueqiuAvatarPath(pathRaw, domainRaw) {
    var path = pickXueqiuAvatarPart(pathRaw);
    if (!path) return '';
    if (/^(data|blob):/i.test(path)) return path.slice(0, 500);
    if (isPackagedAssetPath(path)) return packagedAssetUrl(path);
    if (/^https?:\/\//i.test(path) || path.indexOf('//') === 0) return forceHttps(path).slice(0, 500);
    var domain = forceHttps(
      String(domainRaw || absoluteAvatarHost(pathRaw) || XQ_AVATAR_DEFAULT)
        .trim()
        .replace(/\/$/, '')
    );
    if (path.indexOf('/') !== 0) path = '/' + path;
    return (domain + path).slice(0, 500);
  }

  function xueqiuAvatarUrl(raw) {
    if (raw == null) return '';
    if (typeof raw === 'string') return resolveXueqiuAvatarPath(raw);
    if (typeof raw !== 'object') return '';
    var path = String(raw.profile_image_url || raw.profile_image || raw.avatar || '').trim();
    if (!path) return '';
    return resolveXueqiuAvatarPath(path, String(raw.photo_domain || '').trim() || undefined);
  }

  // MAIN-world reinjection (for example during WXT HMR) must keep the original
  // immutable config rather than redefining its non-configurable global.
  if (!Object.prototype.hasOwnProperty.call(globalThis, 'XQ_DADAO_CONFIG')) {
    Object.defineProperty(globalThis, 'XQ_DADAO_CONFIG', {
      value: Object.freeze({
        TARGET: TARGET,
        DEFAULT_SOURCES: DEFAULT_SOURCES,
        MSG_TAG: MSG_TAG,
        LIMIT: LIMIT,
        feedKey: feedKey,
        parseFeedKey: parseFeedKey,
        xueqiuAvatarUrl: xueqiuAvatarUrl
      }),
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
})();
