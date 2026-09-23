/* ═══════════════════════════════════════════════════════════
   한국반려동물이동장례협회 — 소식 페이지 생성기
   · news/posts.json 의 글 목록으로 아래 파일들을 만들어냅니다.
       news/<파일명>.html   기사 페이지 (news/_template.html 의 겉모양 사용)
       news.html            소식 게시판 표 · 전체 건수 · 구조화 데이터
       index.html           홈 '최근 소식' 3건
       sitemap.xml          기사 주소 목록
   · 관리자 페이지(/admin/)와 테스트용 Node 스크립트가 함께 씁니다.
   ═══════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var SITE = 'https://kmpfa.or.kr';
  var ORG = '한국반려동물이동장례협회';
  var CATEGORIES = ['공지', '기획', '보도'];
  var RECENT_COUNT = 3;
  var GENERATED_NOTE = '<!-- 이 파일은 소식 관리(/admin/)에서 자동으로 만들어집니다. 직접 고치면 다음 게시 때 덮어써집니다. -->';

  /* ── 공통 도구 ───────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function jsonLd(obj) {
    // </script> 로 스크립트가 끊기지 않도록 '<' 를 이스케이프
    return JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');
  }
  function replaceBetween(src, name, content, file) {
    var open = '<!--@' + name + '-->', close = '<!--@/' + name + '-->';
    var a = src.indexOf(open), b = src.indexOf(close);
    if (a < 0 || b < 0 || b < a) {
      throw new Error((file || '파일') + '에서 자동 갱신 표식(' + open + ')을 찾지 못했습니다.');
    }
    return src.slice(0, a + open.length) + content + src.slice(b);
  }
  function between(src, name) {
    var open = '<!--@' + name + '-->', close = '<!--@/' + name + '-->';
    var a = src.indexOf(open), b = src.indexOf(close);
    if (a < 0 || b < 0) return null;
    return src.slice(a + open.length, b);
  }
  function isFullDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || ''); }
  function displayDate(d) { return String(d || '').replace(/-/g, '.'); }
  function slugOk(slug) { return /^[a-z0-9][a-z0-9-]{0,59}$/.test(slug || '') && slug !== '_template'; }

  /* 오래된 글 → 최신 글 순서 (날짜, 같은 날이면 번호) */
  function chronological(posts) {
    return posts.slice().sort(function (a, b) {
      var da = String(a.date), db = String(b.date);
      // '2026-09' 처럼 월만 있는 날짜는 그 달 1일로 비교
      if (da.length === 7) da += '-01';
      if (db.length === 7) db += '-01';
      if (da !== db) return da < db ? -1 : 1;
      return (a.no || 0) - (b.no || 0);
    });
  }
  function newestFirst(posts) { return chronological(posts).reverse(); }

  /* 글 하나가 바뀔 때 이전글·다음글 링크가 달라지는 이웃 글까지 포함한 목록 */
  function neighbors(posts, slug) {
    var c = chronological(posts), out = [];
    for (var i = 0; i < c.length; i++) {
      if (c[i].slug === slug) {
        if (c[i - 1]) out.push(c[i - 1].slug);
        if (c[i + 1]) out.push(c[i + 1].slug);
      }
    }
    return out;
  }

  function badge(cat) {
    return '<span class="badge' + (cat === '공지' ? ' notice' : '') + '">' + esc(cat) + '</span>';
  }
  function imageUrl(post) {
    return post.image ? SITE + '/' + post.image : SITE + '/images/og.jpg';
  }
  function imageSize(post) {
    if (post.image) return [post.imageWidth || 1600, post.imageHeight || 900];
    return [1200, 630];
  }

  /* ── 기사 페이지 ─────────────────────────────────────── */
  function renderHead(post) {
    var url = SITE + '/news/' + post.slug + '.html';
    var size = imageSize(post);
    return [
      '',
      GENERATED_NOTE,
      '<title>' + esc(post.title) + ' | ' + ORG + '</title>',
      '<meta name="description" content="' + esc(post.description) + '">',
      '<meta name="robots" content="index,follow,max-image-preview:large">',
      '<link rel="canonical" href="' + url + '">',
      '<link rel="icon" href="../images/favicon.svg" type="image/svg+xml">',
      '<meta property="og:locale" content="ko_KR">',
      '<meta property="og:site_name" content="' + ORG + '">',
      '<meta property="og:type" content="article">',
      '<meta property="og:title" content="' + esc(post.title) + '">',
      '<meta property="og:description" content="' + esc(post.description) + '">',
      '<meta property="og:url" content="' + url + '">',
      '<meta property="og:image" content="' + imageUrl(post) + '">',
      '<meta property="og:image:width" content="' + size[0] + '">',
      '<meta property="og:image:height" content="' + size[1] + '">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:title" content="' + esc(post.title) + '">',
      '<meta name="twitter:description" content="' + esc(post.description) + '">',
      '<meta name="twitter:image" content="' + imageUrl(post) + '">',
      ''
    ].join('\n');
  }

  function renderArticleLd(post) {
    var url = SITE + '/news/' + post.slug + '.html';
    var ld = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: post.title,
      datePublished: post.date,
      author: { '@type': 'Organization', name: ORG },
      publisher: {
        '@type': 'Organization',
        name: ORG,
        logo: { '@type': 'ImageObject', url: SITE + '/images/logo-512.png' }
      },
      description: post.description,
      mainEntityOfPage: url,
      image: imageUrl(post)
    };
    if (isFullDate(post.updated) && post.updated !== post.date) ld.dateModified = post.updated;
    if (post.press && post.press.url) ld.sameAs = post.press.url;
    return '\n<script type="application/ld+json">\n' + jsonLd(ld) + '\n</script>\n';
  }

  function pnItem(label, other) {
    if (!other) {
      return '        <li><span class="lb">' + label + '</span><span class="none">' + label + '이 없습니다</span></li>';
    }
    return '        <li><span class="lb">' + label + '</span><a href="' + other.slug + '.html">' + esc(other.title) + '</a></li>';
  }

  function renderMain(post, prev, next) {
    var press = post.press && post.press.url ? post.press : null;
    var origin = press
      ? '<div class="origin"><p class="lb">언론 보도 원문</p><a href="' + esc(press.url) + '" target="_blank" rel="noopener">' + esc(press.name || '원문') + ' — 기사 보기 ↗</a></div>'
      : '<div class="origin"><p class="lb">언론 보도 원문</p><p class="wait">언론 게재 준비 중입니다. 게재 후 이 자리에 원문 링크를 연결합니다.</p></div>';
    var lines = [
      '',
      '<article>',
      '  <section class="banner" style="padding:72px 0 32px;border-bottom:1px solid #E2DCD0">',
      '    <div class="wrap art" style="max-width:800px;margin:0 auto;padding:0 24px">',
      '      <div class="crumbs" style="font-size:.85rem;color:#847C71;margin-bottom:22px">',
      '        <a href="../index.html" style="color:#847C71">홈</a><span style="margin:0 8px">›</span><a href="../news.html" style="color:#847C71">소식</a><span style="margin:0 8px">›</span>' + esc(post.category),
      '      </div>',
      '      <p style="margin:0 0 12px">' + badge(post.category) + '</p>',
      '      <h1 style="font-family:\'Nanum Myeongjo\',\'Batang\',serif;font-weight:800;line-height:1.35;letter-spacing:-.01em;color:#2A2724;font-size:clamp(1.7rem,3.4vw,2.6rem);margin:0">' + esc(post.title) + '</h1>'
    ];
    if (post.deck) lines.push('      <p class="deck">' + esc(post.deck) + '</p>');
    lines.push(
      '      <div class="meta"><span><b>번호</b>' + post.no + '</span><span><b>작성일</b><time datetime="' + esc(post.date) + '">' + displayDate(post.date) + '</time></span><span><b>작성</b>' + ORG + ' 사무국</span><span><b>게재</b>' + (press ? esc(press.name || '언론') : '준비 중') + '</span></div>',
      '    </div>',
      '  </section>',
      '  <section style="padding:52px 0 80px">',
      '    <div class="wrap art" style="max-width:800px;margin:0 auto;padding:0 24px">',
      '      <div class="body">',
      post.body,
      '      </div>',
      '      <div class="ask"><b>문의</b> · ' + ORG + ' 사무국장 최석윤 · <a href="mailto:fixemhot@gmail.com" style="color:#7A6247">fixemhot@gmail.com</a></div>',
      '      ' + origin,
      '      <ul class="pn">',
      pnItem('이전글', prev),
      pnItem('다음글', next),
      '      </ul>',
      '      <a class="btn-list" href="../news.html">목록</a>',
      '    </div>',
      '  </section>',
      '</article>',
      ''
    );
    return lines.join('\n');
  }

  function renderArticle(template, post, prev, next) {
    var out = template;
    out = replaceBetween(out, 'HEAD', renderHead(post), 'news/_template.html');
    out = replaceBetween(out, 'LD', renderArticleLd(post), 'news/_template.html');
    out = replaceBetween(out, 'MAIN', renderMain(post, prev, next), 'news/_template.html');
    // 생성된 기사에는 표식이 필요 없으므로 지웁니다
    return out.replace(/<!--@\/?(HEAD|LD|MAIN)-->\n?/g, '');
  }

  /* ── 소식 게시판(news.html) ──────────────────────────── */
  function renderBoardRows(posts) {
    var rows = newestFirst(posts).map(function (p) {
      var deck = p.deck && p.deckInList ? ' <span style="color:#847C71;font-size:.9em">— ' + esc(p.deck) + '</span>' : '';
      var press = p.press && p.press.url
        ? '<a class="press-link" href="' + esc(p.press.url) + '" target="_blank" rel="noopener">' + esc(p.press.name || '원문') + ' ↗</a>'
        : '<span class="press-wait">게재 준비 중</span>';
      return [
        '      <tr>',
        '        <td class="no">' + p.no + '</td>',
        '        <td class="cat">' + badge(p.category) + '</td>',
        '        <td class="tit"><a href="news/' + p.slug + '.html">' + esc(p.title) + deck + '</a></td>',
        '        <td class="date"><time datetime="' + esc(p.date) + '">' + displayDate(p.date) + '</time></td>',
        '        <td class="press">' + press + '</td>',
        '      </tr>'
      ].join('\n');
    });
    return '\n' + rows.join('\n') + '\n      ';
  }

  function renderBoardLd(posts) {
    var list = newestFirst(posts);
    var ld = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: '소식',
      url: SITE + '/news.html',
      description: ORG + ' 언론 보도, 기획 기사, 공청회 공지 등 활동 소식',
      isPartOf: { '@type': 'WebSite', name: ORG, url: SITE + '/' },
      publisher: { '@type': 'NGO', name: ORG, url: SITE + '/', logo: SITE + '/images/logo-512.png' },
      mainEntity: {
        '@type': 'ItemList',
        itemListOrder: 'https://schema.org/ItemListOrderDescending',
        numberOfItems: list.length,
        itemListElement: list.map(function (p, i) {
          return { '@type': 'ListItem', position: i + 1, url: SITE + '/news/' + p.slug + '.html', name: p.title };
        })
      }
    };
    return '\n<script type="application/ld+json">\n' + jsonLd(ld) + '\n</script>\n';
  }

  function updateNewsPage(html, posts) {
    html = replaceBetween(html, 'COUNT', String(posts.length), 'news.html');
    html = replaceBetween(html, 'ROWS', renderBoardRows(posts), 'news.html');
    html = replaceBetween(html, 'LD', renderBoardLd(posts), 'news.html');
    return html;
  }

  /* ── 홈 '최근 소식' (index.html) ─────────────────────── */
  function updateIndexPage(html, posts) {
    var items = newestFirst(posts).slice(0, RECENT_COUNT).map(function (p) {
      return '<li style="display:grid;grid-template-columns:78px 40px 1fr;gap:14px;padding:11px 0;border-bottom:1px solid #E2DCD0;align-items:baseline">' +
        '<time datetime="' + esc(p.date) + '" style="color:#847C71;font-size:.9rem">' + displayDate(p.date) + '</time>' +
        '<span class="cat" style="font-size:.82rem;color:#7A6247;font-weight:500">' + esc(p.category) + '</span>' +
        '<a href="news/' + p.slug + '.html" style="color:#2A2724;text-decoration:none;font-size:.98rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block">' + esc(p.title) + '</a></li>';
    });
    return replaceBetween(html, 'RECENT', '\n' + items.join('\n') + '\n', 'index.html');
  }

  /* ── sitemap.xml ─────────────────────────────────────── */
  function updateSitemap(xml, posts, today) {
    var urls = newestFirst(posts).map(function (p) {
      var lastmod = isFullDate(p.updated) ? p.updated : (isFullDate(p.date) ? p.date : today);
      return '  <url><loc>' + SITE + '/news/' + p.slug + '.html</loc><lastmod>' + lastmod +
        '</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>';
    });
    xml = replaceBetween(xml, 'NEWS', '\n' + urls.join('\n') + '\n  ', 'sitemap.xml');
    // 목록이 바뀌는 페이지(홈, 소식)는 오늘 날짜로
    ['/', '/news.html'].forEach(function (path) {
      var re = new RegExp('(<loc>' + SITE.replace(/\./g, '\\.') + path.replace(/\./g, '\\.') + '</loc><lastmod>)[0-9-]+(</lastmod>)');
      xml = xml.replace(re, '$1' + today + '$2');
    });
    return xml;
  }

  /* ── 전체 생성 ───────────────────────────────────────── */
  /*  input: { template, newsHtml, indexHtml, sitemapXml, posts, today, only }
      only: 다시 만들 기사 파일명 목록 (생략하면 전부)
      반환: { 'news/founding.html': '...', 'news.html': '...', ... } */
  function buildAll(input) {
    var posts = input.posts;
    validatePosts(posts);
    var files = {};
    var chrono = chronological(posts);
    chrono.forEach(function (p, i) {
      if (input.only && input.only.indexOf(p.slug) < 0) return;
      files['news/' + p.slug + '.html'] = renderArticle(input.template, p, chrono[i - 1] || null, chrono[i + 1] || null);
    });
    files['news.html'] = updateNewsPage(input.newsHtml, posts);
    files['index.html'] = updateIndexPage(input.indexHtml, posts);
    files['sitemap.xml'] = updateSitemap(input.sitemapXml, posts, input.today);
    files['news/posts.json'] = serializePosts(posts);
    return files;
  }

  function validatePosts(posts) {
    var seenSlug = {}, seenNo = {};
    posts.forEach(function (p) {
      if (!slugOk(p.slug)) throw new Error('파일 주소가 올바르지 않습니다: ' + p.slug);
      if (seenSlug[p.slug]) throw new Error('같은 파일 주소가 두 번 있습니다: ' + p.slug);
      if (seenNo[p.no]) throw new Error('같은 번호가 두 번 있습니다: ' + p.no);
      seenSlug[p.slug] = seenNo[p.no] = true;
      if (!p.title) throw new Error('제목이 비어 있는 글이 있습니다.');
      if (CATEGORIES.indexOf(p.category) < 0) throw new Error('분류가 올바르지 않습니다: ' + p.category);
      if (!/^\d{4}-\d{2}(-\d{2})?$/.test(p.date || '')) throw new Error('작성일 형식이 올바르지 않습니다: ' + p.date);
    });
  }

  function serializePosts(posts) {
    var ordered = newestFirst(posts).map(function (p) {
      return {
        slug: p.slug, no: p.no, category: p.category, title: p.title,
        deck: p.deck || '', deckInList: !!p.deckInList,
        date: p.date, updated: p.updated || '',
        description: p.description || '',
        image: p.image || '', imageWidth: p.imageWidth || 0, imageHeight: p.imageHeight || 0,
        press: p.press && p.press.url ? { name: p.press.name || '', url: p.press.url } : null,
        body: p.body
      };
    });
    return JSON.stringify({ version: 1, posts: ordered }, null, 2) + '\n';
  }

  /* ── 요약 자동 생성 (비워두면 첫 문단에서) ───────────── */
  function autoDescription(bodyHtml, max) {
    max = max || 110;
    var text = String(bodyHtml || '')
      .replace(/<figure[\s\S]*?<\/figure>/gi, ' ')
      .replace(/<(h2|table)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    var cut = text.slice(0, max);
    var dot = Math.max(cut.lastIndexOf('다.'), cut.lastIndexOf('요.'));
    return dot > 40 ? cut.slice(0, dot + 2) : cut.replace(/\s+\S*$/, '') + '…';
  }

  /* ── 편집기 ↔ 사이트 본문 변환 (브라우저 전용) ─────────
     편집기(Toast UI)는 class 를 지우므로, 게시할 때 사이트 모양을 입힙니다.
       첫 문단      → <p class="lead">
       인용(>)      → <p class="quote">
       사진         → <figure class="feat"> + 사진 설명
       제목 1~4     → <h2> 소제목
       표           → <table class="officers">                         */
  var INLINE = { STRONG: 1, B: 1, EM: 1, I: 1, U: 1, S: 1, DEL: 1, A: 1, BR: 1, CODE: 1, SPAN: 1, MARK: 1 };

  function cleanInline(node, doc) {
    var frag = doc.createDocumentFragment();
    Array.prototype.forEach.call(node.childNodes, function (c) {
      if (c.nodeType === 3) { frag.appendChild(doc.createTextNode(c.nodeValue)); return; }
      if (c.nodeType !== 1) return;
      var tag = c.tagName;
      if (tag === 'IMG') return; // 사진은 문단 밖으로 따로 뺍니다
      if (!INLINE[tag]) { frag.appendChild(cleanInline(c, doc)); return; }
      if (tag === 'SPAN') { frag.appendChild(cleanInline(c, doc)); return; }
      if (tag === 'BR') { frag.appendChild(doc.createElement('br')); return; }
      var map = { B: 'strong', I: 'em', DEL: 's' };
      var el = doc.createElement((map[tag] || tag).toLowerCase());
      if (tag === 'A') {
        var href = c.getAttribute('href') || '';
        if (!/^(https?:|mailto:|tel:|\.\.?\/|#|[a-z0-9_-]+\.html)/i.test(href)) href = '';
        if (!href) { frag.appendChild(cleanInline(c, doc)); return; }
        el.setAttribute('href', href);
        if (/^https?:/i.test(href) && href.indexOf(SITE) !== 0) {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener');
        }
      }
      el.appendChild(cleanInline(c, doc));
      frag.appendChild(el);
    });
    return frag;
  }
  function isEmpty(el) {
    return !el.querySelector('img') && !el.textContent.replace(/ /g, ' ').trim();
  }
  function makeFigure(img, doc) {
    var fig = doc.createElement('figure');
    fig.className = 'feat';
    var im = doc.createElement('img');
    im.setAttribute('src', img.getAttribute('src') || '');
    var alt = (img.getAttribute('alt') || '').trim();
    im.setAttribute('alt', alt);
    im.setAttribute('loading', 'lazy');
    fig.appendChild(im);
    if (alt) {
      var cap = doc.createElement('figcaption');
      cap.textContent = alt;
      fig.appendChild(cap);
    }
    return fig;
  }

  function normalizeBody(html, opts) {
    opts = opts || {};
    var doc = new DOMParser().parseFromString('<div id="r">' + (html || '') + '</div>', 'text/html');
    var src = doc.getElementById('r');
    var out = [];
    var leadDone = !opts.leadFirst;

    function pushParagraph(el, cls) {
      var imgs = el.querySelectorAll('img');
      var p = doc.createElement('p');
      if (cls) p.className = cls;
      p.appendChild(cleanInline(el, doc));
      if (p.textContent.replace(/ /g, ' ').trim()) {
        if (!cls && !leadDone) { p.className = 'lead'; leadDone = true; }
        out.push(p.outerHTML);
      }
      Array.prototype.forEach.call(imgs, function (img) { out.push(makeFigure(img, doc).outerHTML); });
    }

    Array.prototype.forEach.call(src.childNodes, function (n) {
      if (n.nodeType === 3) {
        if (n.nodeValue.trim()) { var p = doc.createElement('p'); p.textContent = n.nodeValue.trim(); pushParagraph(p); }
        return;
      }
      if (n.nodeType !== 1) return;
      var tag = n.tagName;
      if (tag === 'P' || tag === 'DIV') {
        if (isEmpty(n)) return;
        if (n.classList.contains('quote')) { pushParagraph(n, 'quote'); return; }
        pushParagraph(n);
      } else if (/^H[1-6]$/.test(tag)) {
        if (isEmpty(n)) return;
        var h = doc.createElement('h2');
        h.appendChild(cleanInline(n, doc));
        out.push(h.outerHTML);
      } else if (tag === 'BLOCKQUOTE') {
        var inner = n.querySelectorAll('p');
        if (!inner.length) { pushParagraph(n, 'quote'); return; }
        Array.prototype.forEach.call(inner, function (p) { if (!isEmpty(p)) pushParagraph(p, 'quote'); });
      } else if (tag === 'FIGURE') {
        var img = n.querySelector('img');
        if (!img) return;
        var cap = n.querySelector('figcaption');
        if (cap && !img.getAttribute('alt')) img.setAttribute('alt', cap.textContent.trim());
        if (cap) img.setAttribute('alt', cap.textContent.trim());
        out.push(makeFigure(img, doc).outerHTML);
      } else if (tag === 'IMG') {
        out.push(makeFigure(n, doc).outerHTML);
      } else if (tag === 'UL' || tag === 'OL') {
        var list = doc.createElement(tag.toLowerCase());
        Array.prototype.forEach.call(n.querySelectorAll(':scope > li'), function (li) {
          var nl = doc.createElement('li');
          nl.appendChild(cleanInline(li, doc));
          if (nl.textContent.trim()) list.appendChild(nl);
        });
        if (list.children.length) out.push(list.outerHTML);
      } else if (tag === 'TABLE') {
        var t = doc.createElement('table');
        t.className = 'officers';
        var capEl = n.querySelector('caption');
        if (capEl && capEl.textContent.trim()) {
          var c2 = doc.createElement('caption'); c2.textContent = capEl.textContent.trim(); t.appendChild(c2);
        }
        Array.prototype.forEach.call(n.querySelectorAll('tr'), function (tr) {
          var r = doc.createElement('tr');
          Array.prototype.forEach.call(tr.children, function (cell) {
            var c = doc.createElement(cell.tagName === 'TH' ? 'th' : 'td');
            c.appendChild(cleanInline(cell, doc));
            r.appendChild(c);
          });
          t.appendChild(r);
        });
        out.push(t.outerHTML);
      } else if (tag === 'HR') {
        out.push('<hr>');
      } else {
        pushParagraph(n);
      }
    });
    return out.join('\n');
  }

  /* 사이트 본문 → 편집기에 넣을 모양 */
  function bodyToEditor(html) {
    var doc = new DOMParser().parseFromString('<div id="r">' + (html || '') + '</div>', 'text/html');
    var r = doc.getElementById('r');
    Array.prototype.forEach.call(r.querySelectorAll('p.quote'), function (p) {
      var bq = doc.createElement('blockquote');
      p.parentNode.insertBefore(bq, p);
      p.removeAttribute('class');
      bq.appendChild(p);
    });
    Array.prototype.forEach.call(r.querySelectorAll('p.lead'), function (p) { p.removeAttribute('class'); });
    Array.prototype.forEach.call(r.querySelectorAll('figure'), function (f) {
      var img = f.querySelector('img');
      var cap = f.querySelector('figcaption');
      var p = doc.createElement('p');
      if (img) {
        var im = doc.createElement('img');
        im.setAttribute('src', img.getAttribute('src'));
        im.setAttribute('alt', cap ? cap.textContent.trim() : (img.getAttribute('alt') || ''));
        p.appendChild(im);
      }
      f.parentNode.replaceChild(p, f);
    });
    return r.innerHTML;
  }

  /* 본문에서 쓰는 사진 경로 (사이트 루트 기준, 예: images/news/a.jpg) */
  function bodyImages(html) {
    var re = /<img[^>]+src="([^"]+)"/g, m, out = [];
    while ((m = re.exec(html || ''))) {
      var src = m[1].replace(/^\.\.\//, '');
      if (/^images\/news\//.test(src) && out.indexOf(src) < 0) out.push(src);
    }
    return out;
  }

  var api = {
    SITE: SITE, CATEGORIES: CATEGORIES,
    esc: esc, between: between, replaceBetween: replaceBetween,
    chronological: chronological, newestFirst: newestFirst, neighbors: neighbors, displayDate: displayDate, slugOk: slugOk,
    isFullDate: isFullDate,
    renderArticle: renderArticle, updateNewsPage: updateNewsPage, updateIndexPage: updateIndexPage,
    updateSitemap: updateSitemap, buildAll: buildAll, serializePosts: serializePosts, validatePosts: validatePosts,
    autoDescription: autoDescription, normalizeBody: normalizeBody, bodyToEditor: bodyToEditor, bodyImages: bodyImages
  };
  root.NewsGen = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
