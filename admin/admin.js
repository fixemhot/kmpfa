/* ═══════════════════════════════════════════════════════════
   소식 관리 — 관리자 화면 동작
   · GitHub 저장소(fixemhot/kmpfa)의 news/posts.json 을 읽고,
     글을 게시·수정·삭제할 때 관련 파일을 한 번의 커밋으로 올립니다.
   · 관리 열쇠(토큰)는 이 브라우저에만 저장되며 api.github.com 으로만 보냅니다.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var G = window.NewsGen;
  var CFG = { owner: 'fixemhot', repo: 'kmpfa', branch: 'main', api: 'https://api.github.com' };
  var TOKEN_KEY = 'kmpfa-admin-token';
  var DRAFT_KEY = 'kmpfa-admin-draft';
  var MAX_W = 1600, JPEG_Q = 0.85;

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    token: '', login: '', posts: [], editing: null, pending: {}, bodyDirty: false, formDirty: false,
    template: null, savedRange: null, draftTimer: null,
    recent: {} // 방금 올린 사진: 사이트 반영 전까지 편집기에서 보여줄 임시 주소
  };

  /* ── 저장소(브라우저) — 사생활 모드 등에서 막혀도 동작하도록 ── */
  function st(kind) { try { return window[kind]; } catch (e) { return null; } }
  function sget(kind, k) { try { var s = st(kind); return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function sset(kind, k, v) { try { var s = st(kind); if (s) s.setItem(k, v); } catch (e) { /* 무시 */ } }
  function sdel(kind, k) { try { var s = st(kind); if (s) s.removeItem(k); } catch (e) { /* 무시 */ } }

  /* ── 화면 도구 ───────────────────────────────────────── */
  function show(view) {
    ['viewLogin', 'viewList', 'viewEdit'].forEach(function (v) { $(v).hidden = v !== view; });
    $('barAct').hidden = view === 'viewLogin';
    window.scrollTo(0, 0);
  }
  var toastTimer;
  function toast(msg, opts) {
    opts = opts || {};
    var t = $('toast');
    t.textContent = '';
    t.className = 'toast' + (opts.err ? ' err' : '');
    t.appendChild(document.createTextNode(msg));
    if (opts.link) {
      t.appendChild(document.createTextNode(' '));
      var a = document.createElement('a');
      a.href = opts.link.href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = opts.link.text;
      t.appendChild(a);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, opts.err ? 9000 : 6000);
  }
  function busy(text) { $('busyText').textContent = text; $('busy').hidden = false; }
  function done() { $('busy').hidden = true; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ── GitHub API ──────────────────────────────────────── */
  function repoPath(p) { return '/repos/' + CFG.owner + '/' + CFG.repo + (p || ''); }
  function encodePath(p) { return p.split('/').map(encodeURIComponent).join('/'); }
  function ghMessage(status, msg) {
    if (status === 401) return '관리 열쇠(토큰)가 올바르지 않거나 만료되었습니다. 새로 만들어 다시 들어와 주세요.';
    if (status === 403 && /rate limit/i.test(msg)) return 'GitHub 요청 한도를 넘었습니다. 잠시 뒤 다시 시도해 주세요.';
    if (status === 403) return '이 열쇠에는 홈페이지 파일을 고칠 권한이 없습니다. 토큰을 만들 때 fixemhot/kmpfa 저장소를 고르고 Contents 권한을 "Read and write"로 했는지 확인해 주세요.';
    if (status === 404) return '저장소나 파일을 찾지 못했습니다. 토큰을 만들 때 fixemhot/kmpfa 저장소를 골랐는지 확인해 주세요.';
    if (status === 409 || status === 422) return '다른 곳에서 동시에 파일이 바뀌어 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
    return 'GitHub 오류(' + status + ')' + (msg ? ': ' + msg : '');
  }
  async function gh(path, opts) {
    opts = opts || {};
    var headers = {
      Authorization: 'Bearer ' + state.token,
      Accept: opts.accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(CFG.api + path, {
        method: opts.method || 'GET', headers: headers, cache: 'no-store',
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
    } catch (e) {
      throw new Error('인터넷 연결을 확인해 주세요. GitHub에 접속하지 못했습니다.');
    }
    if (!res.ok) {
      var msg = '';
      try { msg = (await res.json()).message || ''; } catch (e) { /* 무시 */ }
      var step = (opts.method || 'GET') + ' ' + path.replace(repoPath(''), '').split('?')[0];
      var err = new Error(ghMessage(res.status, msg) + (res.status >= 403 ? '\n[GitHub 응답 ' + res.status + ' · ' + step + (msg ? ' · ' + msg : '') + ']' : ''));
      err.status = res.status;
      err.ghMsg = msg;
      throw err;
    }
    if (opts.raw) return res.text();
    return res.status === 204 ? null : res.json();
  }
  function getFile(path, ref) {
    return gh(repoPath('/contents/' + encodePath(path) + '?ref=' + encodeURIComponent(ref || CFG.branch)),
      { accept: 'application/vnd.github.raw+json', raw: true });
  }
  async function listDir(path, ref) {
    try {
      var r = await gh(repoPath('/contents/' + encodePath(path) + '?ref=' + encodeURIComponent(ref)));
      return Array.isArray(r) ? r.map(function (x) { return x.path; }) : [];
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }
  function parsePosts(text) {
    var data = JSON.parse(text);
    return Array.isArray(data) ? data : (data.posts || []);
  }

  /* 저장소의 현재 상태를 한꺼번에 읽어옵니다 */
  async function loadContext() {
    var ref = await gh(repoPath('/git/ref/heads/' + CFG.branch));
    var sha = ref.object.sha;
    var r = await Promise.all([
      getFile('news/posts.json', sha), getFile('news/_template.html', sha), getFile('news.html', sha),
      getFile('index.html', sha), getFile('sitemap.xml', sha), listDir('images/news', sha)
    ]);
    return { sha: sha, posts: parsePosts(r[0]), template: r[1], newsHtml: r[2], indexHtml: r[3], sitemapXml: r[4], images: r[5] };
  }

  /* 여러 파일을 커밋 하나로 올립니다. files[path] = 문자열 | {base64} | null(삭제) */
  async function commit(parentSha, files, message) {
    var base = await gh(repoPath('/git/commits/' + parentSha));
    var tree = [];
    var paths = Object.keys(files);
    for (var i = 0; i < paths.length; i++) {
      var path = paths[i], v = files[path];
      if (v === null) {
        tree.push({ path: path, mode: '100644', type: 'blob', sha: null });
      } else if (typeof v === 'string') {
        tree.push({ path: path, mode: '100644', type: 'blob', content: v });
      } else {
        busy('사진 올리는 중… (' + path.split('/').pop() + ')');
        var blob = await gh(repoPath('/git/blobs'), { method: 'POST', body: { content: v.base64, encoding: 'base64' } });
        tree.push({ path: path, mode: '100644', type: 'blob', sha: blob.sha });
      }
    }
    busy('저장하는 중…');
    var newTree = await gh(repoPath('/git/trees'), { method: 'POST', body: { base_tree: base.tree.sha, tree: tree } });
    if (newTree.sha === base.tree.sha) return null; // 바뀐 것이 없음
    var newCommit = await gh(repoPath('/git/commits'), {
      method: 'POST', body: { message: message, tree: newTree.sha, parents: [parentSha] }
    });
    await gh(repoPath('/git/refs/heads/' + CFG.branch), { method: 'PATCH', body: { sha: newCommit.sha, force: false } });
    return newCommit.sha;
  }

  /* 읽기 → 바꾸기 → 커밋. 그 사이 누가 먼저 올렸으면 한 번 더 시도 */
  async function transact(label, mutate) {
    for (var attempt = 0; attempt < 2; attempt++) {
      busy(label + '…');
      var ctx = await loadContext();
      var out = await mutate(ctx);
      try {
        var sha = await commit(ctx.sha, out.files, out.message);
        return { sha: sha, out: out };
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt === 0) continue;
        throw e;
      }
    }
  }

  /* ── 로그인 ──────────────────────────────────────────── */
  function savedToken() { return sget('sessionStorage', TOKEN_KEY) || sget('localStorage', TOKEN_KEY) || ''; }
  async function login(token, remember) {
    state.token = token;
    busy('확인하는 중…');
    try {
      await gh(repoPath(''));
      try { var me = await gh('/user'); state.login = me && me.login || ''; } catch (e) { state.login = ''; }
      var text;
      try { text = await getFile('news/posts.json'); } catch (e) {
        if (e.status === 404) throw new Error('저장소에 news/posts.json 파일이 없습니다. 소식 관리 설치 파일을 먼저 올려 주세요.');
        throw e;
      }
      state.posts = parsePosts(text);
      if (remember) { sset('localStorage', TOKEN_KEY, token); sdel('sessionStorage', TOKEN_KEY); }
      else { sset('sessionStorage', TOKEN_KEY, token); sdel('localStorage', TOKEN_KEY); }
      renderList();
      show('viewList');
      return true;
    } catch (e) {
      state.token = '';
      sdel('sessionStorage', TOKEN_KEY); sdel('localStorage', TOKEN_KEY);
      show('viewLogin');
      $('loginErr').textContent = e.message;
      $('loginErr').hidden = false;
      return false;
    } finally { done(); }
  }
  function logout() {
    if (state.formDirty && !confirm('저장하지 않은 내용이 있습니다. 그래도 나갈까요?')) return;
    state.token = ''; state.posts = []; state.formDirty = false;
    sdel('sessionStorage', TOKEN_KEY); sdel('localStorage', TOKEN_KEY);
    $('token').value = '';
    show('viewLogin');
  }

  /* ── 글 목록 ─────────────────────────────────────────── */
  function cell(tr, cls, content) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    if (typeof content === 'string') td.textContent = content; else if (content) td.appendChild(content);
    tr.appendChild(td);
    return td;
  }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function renderList() {
    var tb = $('listBody');
    tb.textContent = '';
    var list = G.newestFirst(state.posts);
    $('listInfo').textContent = '전체 ' + list.length + '건 · 게시하거나 고치면 1~3분 뒤 사이트에 반영됩니다.' +
      (state.login ? ' · 열쇠: ' + state.login + ' 계정' : '');
    var warn = $('ownerWarn');
    if (state.login && state.login.toLowerCase() !== CFG.owner) {
      warn.textContent = '지금 들어온 열쇠는 「' + state.login + '」 계정에서 만든 것입니다. 이 열쇠로는 글을 볼 수만 있고 저장할 수 없습니다. ' +
        'GitHub에 「' + CFG.owner + '」 계정으로 로그인해서 열쇠를 다시 만든 뒤, 로그아웃하고 새 열쇠로 들어와 주세요.';
      warn.hidden = false;
    } else warn.hidden = true;
    if (!list.length) {
      var tr0 = document.createElement('tr');
      var td0 = cell(tr0, 'empty', '아직 글이 없습니다. 오른쪽 위 “새 글 쓰기”로 시작하세요.');
      td0.colSpan = 6;
      tb.appendChild(tr0);
      return;
    }
    list.forEach(function (p) {
      var tr = document.createElement('tr');
      cell(tr, 'c-no', String(p.no));
      cell(tr, 'c-cat', el('span', { class: 'badge' + (p.category === '공지' ? ' notice' : '') }, p.category));
      var t = el('span');
      var a = el('a', { href: '../news/' + p.slug + '.html', target: '_blank', rel: 'noopener' }, p.title);
      t.appendChild(a);
      if (p.deck) t.appendChild(el('small', null, p.deck));
      cell(tr, 't', t);
      cell(tr, 'c-date', G.displayDate(p.date));
      cell(tr, 'c-press', el('span', { class: 'dot' + (p.press ? ' on' : '') }, p.press ? '연결됨' : '—'));
      var act = el('span');
      var bEdit = el('button', { type: 'button', class: 'btn small', 'data-act': 'edit', 'data-slug': p.slug }, '수정');
      var bDel = el('button', { type: 'button', class: 'btn small danger', 'data-act': 'del', 'data-slug': p.slug }, '삭제');
      act.appendChild(bEdit); act.appendChild(bDel);
      cell(tr, 'c-act', act);
      tb.appendChild(tr);
    });
  }

  /* ── 편집기 ──────────────────────────────────────────── */
  var ed;
  function blockOf(node) {
    while (node && node !== ed && node.parentNode !== ed) node = node.parentNode;
    return node && node !== ed ? node : null;
  }
  function currentBlock() {
    var sel = window.getSelection();
    if (!sel.rangeCount || !ed.contains(sel.anchorNode)) return null;
    return blockOf(sel.anchorNode);
  }
  function inCaption() {
    var sel = window.getSelection();
    var n = sel.anchorNode;
    while (n && n !== ed) { if (n.tagName === 'FIGCAPTION') return true; n = n.parentNode; }
    return false;
  }
  function saveRange() {
    var sel = window.getSelection();
    if (sel.rangeCount && ed.contains(sel.anchorNode)) state.savedRange = sel.getRangeAt(0).cloneRange();
  }
  function restoreRange() {
    if (!state.savedRange) return;
    var sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(state.savedRange);
  }
  function exec(cmd, val) { document.execCommand(cmd, false, val); }
  function markDirty() { state.bodyDirty = true; state.formDirty = true; scheduleDraft(); }

  function decorateFigure(fig) {
    fig.setAttribute('contenteditable', 'false');
    fig.className = 'feat';
    var img = fig.querySelector('img');
    var cap = fig.querySelector('figcaption');
    if (!cap) { cap = document.createElement('figcaption'); fig.appendChild(cap); }
    if (img && !cap.textContent.trim() && img.getAttribute('alt')) cap.textContent = img.getAttribute('alt');
    cap.setAttribute('contenteditable', 'true');
    if (!fig.querySelector('.fig-del')) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'fig-del'; b.textContent = '사진 빼기';
      fig.appendChild(b);
    }
  }
  function loadEditor(html) {
    ed.innerHTML = html || '';
    Array.prototype.forEach.call(ed.querySelectorAll('img'), function (img) {
      var path = (img.getAttribute('src') || '').replace(/^\.\.\//, '');
      if (state.recent[path]) { img.setAttribute('data-src', img.getAttribute('src')); img.src = state.recent[path]; }
    });
    Array.prototype.forEach.call(ed.querySelectorAll('figure'), decorateFigure);
    // 편집기에서는 첫 문단 크게 보기를 CSS 가 맡으므로 lead 표시는 떼어 둡니다
    Array.prototype.forEach.call(ed.querySelectorAll('p.lead'), function (p) { p.classList.remove('lead'); if (!p.className) p.removeAttribute('class'); });
  }
  function editorHtml() {
    var c = ed.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('.fig-del'), function (b) { b.remove(); });
    Array.prototype.forEach.call(c.querySelectorAll('[contenteditable]'), function (e) { e.removeAttribute('contenteditable'); });
    Array.prototype.forEach.call(c.querySelectorAll('img[data-src]'), function (i) { i.setAttribute('src', i.getAttribute('data-src')); i.removeAttribute('data-src'); });
    return c.innerHTML;
  }
  function caretInto(node) {
    var r = document.createRange();
    r.setStart(node, 0); r.collapse(true);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    state.savedRange = r.cloneRange();
  }
  /* 편집기가 비면 빈 문단 하나를 넣어 둡니다 (글자가 문단 밖에 떠 있지 않도록) */
  function ensureStarter() {
    var html = ed.innerHTML.trim();
    if (!ed.firstElementChild || html === '<br>' || !html) {
      ed.innerHTML = '<p><br></p>';
      caretInto(ed.firstChild);
      return true;
    }
    return false;
  }
  function caretAtEnd(blk) {
    var s = window.getSelection();
    if (!s.rangeCount || !s.isCollapsed) return false;
    var r = s.getRangeAt(0).cloneRange();
    r.setEnd(blk, blk.childNodes.length);
    return !r.toString().replace(/ /g, ' ').trim();
  }
  function ensureTrailingParagraph() {
    var last = ed.lastElementChild;
    if (!last || last.tagName === 'FIGURE' || last.tagName === 'HR' || last.tagName === 'TABLE') {
      var p = document.createElement('p'); p.appendChild(document.createElement('br')); ed.appendChild(p);
    }
  }

  function onToolbar(cmd) {
    ed.focus();
    restoreRange();
    var blk = currentBlock();
    if (cmd === 'h2') {
      exec('formatBlock', blk && blk.tagName === 'H2' ? '<p>' : '<h2>');
    } else if (cmd === 'bold') {
      exec('bold');
    } else if (cmd === 'quote') {
      if (blk && blk.tagName !== 'P') { exec('formatBlock', '<p>'); blk = currentBlock(); }
      if (!blk) { exec('formatBlock', '<p>'); blk = currentBlock(); }
      if (blk && blk.tagName === 'P') {
        blk.classList.toggle('quote');
        if (!blk.className) blk.removeAttribute('class');
      }
    } else if (cmd === 'ul') {
      exec('insertUnorderedList');
    } else if (cmd === 'link') {
      var sel = window.getSelection();
      var url = window.prompt('연결할 인터넷 주소를 넣어 주세요.', 'https://');
      if (!url || url === 'https://') return;
      url = url.trim();
      if (!/^(https?:|mailto:|tel:)/i.test(url)) url = 'https://' + url;
      restoreRange();
      if (sel.isCollapsed) exec('insertHTML', '<a href="' + G.esc(url) + '">' + G.esc(url) + '</a>');
      else exec('createLink', url);
    } else if (cmd === 'hr') {
      exec('insertHorizontalRule');
      ensureTrailingParagraph();
    } else if (cmd === 'clear') {
      exec('removeFormat'); exec('unlink');
      blk = currentBlock();
      if (blk && /^H\d$/.test(blk.tagName)) exec('formatBlock', '<p>');
      blk = currentBlock();
      if (blk && blk.classList) { blk.classList.remove('quote'); if (!blk.className) blk.removeAttribute('class'); }
    }
    markDirty();
    updateToolbar();
  }
  function updateToolbar() {
    var blk = currentBlock();
    var bar = $('toolbar');
    bar.querySelector('[data-cmd=h2]').classList.toggle('on', !!blk && blk.tagName === 'H2');
    bar.querySelector('[data-cmd=quote]').classList.toggle('on', !!blk && blk.classList && blk.classList.contains('quote'));
    var bold = false;
    try { bold = document.queryCommandState('bold'); } catch (e) { /* 무시 */ }
    bar.querySelector('[data-cmd=bold]').classList.toggle('on', bold);
  }

  /* 사진: 긴 변 1600px 이하 JPG 로 줄여서 넣습니다 */
  function resize(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, MAX_W / img.naturalWidth);
        var w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
        x.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) {
          if (b) resolve({ blob: b, w: w, h: h }); else reject(new Error('사진을 변환하지 못했습니다.'));
        }, 'image/jpeg', JPEG_Q);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('「' + file.name + '」은 열 수 없는 사진 형식입니다. JPG나 PNG로 바꿔서 넣어 주세요.'));
      };
      img.src = url;
    });
  }
  async function addPhotos(files) {
    var list = Array.prototype.filter.call(files || [], function (f) { return /^image\//.test(f.type); });
    if (!list.length) return;
    ed.focus();
    restoreRange();
    var anchor = currentBlock();
    for (var i = 0; i < list.length; i++) {
      try {
        busy('사진 준비 중… (' + (i + 1) + '/' + list.length + ')');
        var r = await resize(list[i]);
        var url = URL.createObjectURL(r.blob);
        state.pending[url] = r;
        var fig = document.createElement('figure');
        var img = document.createElement('img');
        img.src = url; img.alt = '';
        fig.appendChild(img);
        decorateFigure(fig);
        if (anchor && anchor.parentNode === ed) anchor.after(fig); else ed.appendChild(fig);
        anchor = fig;
      } catch (e) {
        toast(e.message, { err: true });
      }
    }
    done();
    ensureTrailingParagraph();
    markDirty();
    if (anchor && anchor.tagName === 'FIGURE') {
      var cap = anchor.querySelector('figcaption');
      cap.focus();
    }
  }

  function setupEditor() {
    ed = $('editor');
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* 무시 */ }
    var bar = $('toolbar');
    bar.addEventListener('mousedown', function (e) { if (e.target.closest('button')) e.preventDefault(); });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-cmd]');
      if (b) onToolbar(b.getAttribute('data-cmd'));
    });
    $('photoInput').addEventListener('change', function (e) {
      addPhotos(e.target.files);
      e.target.value = '';
    });
    ed.addEventListener('input', function () { ensureStarter(); markDirty(); });
    ed.addEventListener('keyup', function () { saveRange(); updateToolbar(); });
    ed.addEventListener('mouseup', function () { saveRange(); updateToolbar(); });
    document.addEventListener('selectionchange', function () {
      if (document.activeElement && ed.contains(document.activeElement)) saveRange();
    });
    ed.addEventListener('click', function (e) {
      if (e.target.classList.contains('fig-del')) {
        var fig = e.target.closest('figure');
        if (fig) { fig.remove(); markDirty(); }
      }
    });
    ed.addEventListener('focus', ensureStarter);
    ed.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      // 사진 설명은 한 줄로
      if (inCaption()) { e.preventDefault(); return; }
      // 소제목·인용 끝에서 Enter → 다음 줄은 보통 문단
      var blk = currentBlock();
      if (blk && (blk.tagName === 'H2' || (blk.tagName === 'P' && blk.classList.contains('quote'))) && caretAtEnd(blk)) {
        e.preventDefault();
        var p = document.createElement('p');
        p.appendChild(document.createElement('br'));
        blk.after(p);
        caretInto(p);
        markDirty();
        updateToolbar();
      }
    });
    ed.addEventListener('paste', function (e) {
      var cd = e.clipboardData;
      if (!cd) return;
      var imgs = Array.prototype.filter.call(cd.files || [], function (f) { return /^image\//.test(f.type); });
      e.preventDefault();
      if (imgs.length) { saveRange(); addPhotos(imgs); return; }
      var text = cd.getData('text/plain') || '';
      if (inCaption()) { exec('insertText', text.replace(/\s+/g, ' ').trim()); return; }
      var paras = text.replace(/\r\n?/g, '\n').split('\n').map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
      if (!paras.length) return;
      if (paras.length === 1) exec('insertText', paras[0]);
      else exec('insertHTML', paras.map(function (p) { return '<p>' + G.esc(p) + '</p>'; }).join(''));
      markDirty();
    });
    ed.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      e.preventDefault();
      if (files && files.length) { saveRange(); addPhotos(files); }
    });
    ed.addEventListener('dragover', function (e) { e.preventDefault(); });
  }

  /* ── 글쓰기 화면 ─────────────────────────────────────── */
  function suggestSlug(date) {
    var base = (date || todayStr()).replace(/-/g, '');
    var slug = base, n = 2;
    var taken = state.posts.map(function (p) { return p.slug; });
    while (taken.indexOf(slug) >= 0) slug = base + '-' + (n++);
    return slug;
  }
  function fillForm(p) {
    $('fCat').value = p.category || '기획';
    $('fTitle').value = p.title || '';
    $('fDeck').value = p.deck || '';
    $('fDeckInList').checked = !!p.deckInList;
    $('fDesc').value = p.description || '';
    $('fPressName').value = p.press ? p.press.name || '' : '';
    $('fPressUrl').value = p.press ? p.press.url || '' : '';
    var d = p.date || '';
    if (G.isFullDate(d)) { $('fDate').value = d; $('dateHint').hidden = true; }
    else {
      $('fDate').value = '';
      $('dateHint').hidden = !d;
      $('dateHint').textContent = d ? '지금 기록: ' + G.displayDate(d) + ' (월까지만 있음). 날짜를 고르면 그 날짜로 바뀌고, 비워 두면 그대로 둡니다.' : '';
    }
    $('fSlug').value = p.slug || '';
    $('descCount').textContent = String(($('fDesc').value || '').length);
    loadEditor(p.body || '');
  }
  function openEditor(post, draft) {
    state.editing = post ? clone(post) : null;
    state.pending = {};
    state.bodyDirty = false; state.formDirty = false; state.savedRange = null;
    $('editTitle').textContent = post ? '글 고치기' : '새 글 쓰기';
    $('btnPublish').textContent = post ? '고친 내용 저장' : '게시하기';
    $('fSlug').readOnly = !!post;
    if (post) fillForm(post);
    else fillForm({ category: '기획', date: todayStr(), slug: suggestSlug(todayStr()), body: '' });
    // 저장 안 된 글 이어쓰기
    var note = $('draftNote');
    note.hidden = true;
    var dr = draft || readDraft();
    var key = post ? post.slug : '';
    if (dr && dr.key === key) {
      note.textContent = '';
      note.appendChild(document.createTextNode('저장하지 않은 작성 내용이 있습니다 (' + dr.savedAt + ').'));
      var bUse = el('button', { type: 'button', class: 'btn small' }, '이어서 쓰기');
      var bDrop = el('button', { type: 'button', class: 'btn small' }, '버리기');
      bUse.addEventListener('click', function () { applyDraft(dr); note.hidden = true; });
      bDrop.addEventListener('click', function () { clearDraft(); note.hidden = true; });
      note.appendChild(bUse); note.appendChild(bDrop);
      note.hidden = false;
    }
    show('viewEdit');
    setTimeout(function () { (post ? ed : $('fTitle')).focus(); }, 50);
  }
  function backToList() {
    if (state.formDirty && !confirm('저장하지 않은 내용이 있습니다. 목록으로 나갈까요?\n(작성 중이던 글은 이 브라우저에 임시로 남아 있습니다)')) return;
    state.formDirty = false;
    renderList();
    show('viewList');
  }

  /* 임시 저장 (사진은 빠집니다) */
  function scheduleDraft() {
    clearTimeout(state.draftTimer);
    state.draftTimer = setTimeout(saveDraft, 800);
  }
  function saveDraft() {
    if ($('viewEdit').hidden) return;
    var d = new Date();
    var data = {
      key: state.editing ? state.editing.slug : '',
      savedAt: (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
      bodyDirty: state.bodyDirty,
      f: {
        category: $('fCat').value, title: $('fTitle').value, deck: $('fDeck').value, deckInList: $('fDeckInList').checked,
        date: $('fDate').value, description: $('fDesc').value, pressName: $('fPressName').value, pressUrl: $('fPressUrl').value,
        slug: $('fSlug').value
      },
      body: editorHtml()
    };
    sset('localStorage', DRAFT_KEY, JSON.stringify(data));
  }
  function readDraft() { try { return JSON.parse(sget('localStorage', DRAFT_KEY) || 'null'); } catch (e) { return null; } }
  function clearDraft() { sdel('localStorage', DRAFT_KEY); }
  function applyDraft(dr) {
    var f = dr.f;
    $('fCat').value = f.category; $('fTitle').value = f.title; $('fDeck').value = f.deck;
    $('fDeckInList').checked = f.deckInList; if (f.date) $('fDate').value = f.date;
    $('fDesc').value = f.description; $('fPressName').value = f.pressName; $('fPressUrl').value = f.pressUrl;
    if (!state.editing && f.slug) $('fSlug').value = f.slug;
    $('descCount').textContent = String(f.description.length);
    if (dr.bodyDirty || !state.editing) {
      var html = dr.body || '';
      var lost = (html.match(/src="blob:/g) || []).length;
      html = html.replace(/<figure[^>]*>(?:(?!<\/figure>)[\s\S])*src="blob:[\s\S]*?<\/figure>/g, '');
      loadEditor(html);
      state.bodyDirty = true;
      if (lost) toast('임시 저장에는 사진이 남지 않습니다. 사진 ' + lost + '장을 다시 넣어 주세요.');
    }
    state.formDirty = true;
  }

  /* 입력값 확인 */
  function readForm(forPreview) {
    function fail(msg, field) {
      if (forPreview) return null;
      toast(msg, { err: true });
      if (field) field.focus();
      return false;
    }
    var title = $('fTitle').value.trim();
    if (!title && !forPreview) return fail('제목을 입력해 주세요.', $('fTitle'));
    var body = null;
    if (!state.editing || state.bodyDirty || forPreview) {
      body = G.normalizeBody(editorHtml(), { leadFirst: true });
      var text = body.replace(/<figure[\s\S]*?<\/figure>/g, '').replace(/<[^>]+>/g, '').trim();
      if (!text && !forPreview) return fail('본문을 입력해 주세요.', ed);
    }
    var slug = $('fSlug').value.trim().toLowerCase();
    if (!state.editing && !G.slugOk(slug) && !forPreview) {
      return fail('페이지 주소는 영어 소문자·숫자·하이픈(-)만 쓸 수 있습니다. 예) 20260923', $('fSlug'));
    }
    var pressUrl = $('fPressUrl').value.trim();
    if (pressUrl && !forPreview) {
      if (!/^https?:\/\//i.test(pressUrl)) pressUrl = 'https://' + pressUrl;
      try { new URL(pressUrl); } catch (e) { return fail('언론 기사 주소가 올바르지 않습니다.', $('fPressUrl')); }
    }
    var pressName = $('fPressName').value.trim();
    if (pressUrl && !pressName) { try { pressName = new URL(pressUrl).hostname.replace(/^www\./, ''); } catch (e) { pressName = '원문'; } }
    return {
      category: $('fCat').value, title: title, deck: $('fDeck').value.trim(), deckInList: $('fDeckInList').checked,
      date: $('fDate').value, description: $('fDesc').value.trim().replace(/\s+/g, ' '),
      pressName: pressName, pressUrl: pressUrl, slug: slug, body: body
    };
  }

  function blobToBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1]); };
      r.onerror = function () { rej(new Error('사진을 읽지 못했습니다.')); };
      r.readAsDataURL(blob);
    });
  }
  function measure(src) {
    return new Promise(function (res) {
      var i = new Image();
      i.onload = function () { res([i.naturalWidth, i.naturalHeight]); };
      i.onerror = function () { res([1600, 900]); };
      i.src = src;
    });
  }
  function usedImages(posts) {
    var used = {};
    posts.forEach(function (p) { G.bodyImages(p.body).forEach(function (i) { used[i] = true; }); });
    return used;
  }

  /* ── 게시 / 저장 ─────────────────────────────────────── */
  async function publish() {
    var form = readForm(false);
    if (!form) return;
    var isNew = !state.editing;
    var editingSlug = isNew ? null : state.editing.slug;
    var today = todayStr();
    var pending = state.pending;
    var uploaded = {};
    try {
      var res = await transact(isNew ? '게시하는 중' : '저장하는 중', async function (ctx) {
        var posts = clone(ctx.posts);
        var old = null, idx = -1;
        if (!isNew) {
          for (var i = 0; i < posts.length; i++) if (posts[i].slug === editingSlug) { old = posts[i]; idx = i; }
          if (!old) throw new Error('이 글이 저장소에서 사라졌습니다. 목록을 새로 고친 뒤 다시 시도해 주세요.');
        }
        var slug = isNew ? form.slug : old.slug;
        if (isNew && posts.some(function (p) { return p.slug === slug; })) {
          throw new Error('같은 페이지 주소(' + slug + ')를 쓰는 글이 이미 있습니다. 주소를 바꿔 주세요.');
        }
        var files = {};
        uploaded = {};
        var body = form.body == null ? old.body : form.body;

        // 새 사진 → images/news/<주소>-<번호>.jpg
        var taken = {};
        ctx.images.forEach(function (p) { taken[p] = true; });
        var dims = {}, n = 1;
        var blobs = uniq((body.match(/blob:[^"]+/g) || []));
        for (var b = 0; b < blobs.length; b++) {
          var info = pending[blobs[b]];
          if (!info) { body = body.split(blobs[b]).join(''); continue; }
          var name;
          do { name = 'images/news/' + slug + '-' + (n++) + '.jpg'; } while (taken[name]);
          taken[name] = true;
          files[name] = { base64: await blobToBase64(info.blob) };
          uploaded[name] = blobs[b];
          dims[name] = [info.w, info.h];
          body = body.split(blobs[b]).join('../' + name);
        }

        // 공유 미리보기 사진 = 본문 첫 사진
        var image = G.bodyImages(body)[0] || '';
        var w = 0, h = 0;
        if (image) {
          if (dims[image]) { w = dims[image][0]; h = dims[image][1]; }
          else if (old && old.image === image && old.imageWidth) { w = old.imageWidth; h = old.imageHeight; }
          else { var d = await measure('../' + image); w = d[0]; h = d[1]; }
        }
        var maxNo = posts.reduce(function (m, p) { return Math.max(m, p.no || 0); }, 0);
        var post = {
          slug: slug,
          no: isNew ? maxNo + 1 : old.no,
          category: form.category, title: form.title, deck: form.deck, deckInList: form.deckInList,
          date: form.date || (old && old.date) || today,
          updated: today,
          description: form.description || G.autoDescription(body),
          image: image, imageWidth: w, imageHeight: h,
          press: form.pressUrl ? { name: form.pressName, url: form.pressUrl } : null,
          body: body
        };
        var before = isNew ? [] : G.neighbors(posts, slug);
        if (isNew) posts.push(post); else posts[idx] = post;
        var after = G.neighbors(posts, slug);

        var built = G.buildAll({
          template: ctx.template, newsHtml: ctx.newsHtml, indexHtml: ctx.indexHtml, sitemapXml: ctx.sitemapXml,
          posts: posts, today: today, only: uniq([slug].concat(before, after))
        });
        Object.keys(built).forEach(function (k) { files[k] = built[k]; });

        // 고치면서 빠진 사진 정리 (다른 글에서 쓰지 않는 것만)
        if (old) {
          var used = usedImages(posts);
          G.bodyImages(old.body).forEach(function (im) {
            if (!used[im] && ctx.images.indexOf(im) >= 0) files[im] = null;
          });
        }
        return { files: files, posts: posts, post: post,
          message: (isNew ? '소식 게시: ' : '소식 수정: ') + post.title };
      });
      done();
      state.posts = res.out.posts;
      state.formDirty = false;
      clearDraft();
      Object.keys(uploaded).forEach(function (p) { state.recent[p] = uploaded[p]; });
      Object.keys(pending).forEach(function (u) {
        if (!Object.keys(uploaded).some(function (p) { return uploaded[p] === u; })) URL.revokeObjectURL(u);
      });
      state.pending = {};
      renderList();
      show('viewList');
      var url = '../news/' + res.out.post.slug + '.html';
      toast(res.sha
        ? (isNew ? '게시했습니다.' : '저장했습니다.') + ' 1~3분 뒤 사이트에 반영됩니다.'
        : '바뀐 내용이 없어 저장하지 않았습니다.', { link: res.sha ? { href: url, text: '기사 보기 ↗' } : null });
    } catch (e) {
      done();
      toast(e.message || String(e), { err: true });
      if (e.status === 401) logout();
    }
  }

  /* ── 삭제 ────────────────────────────────────────────── */
  async function removePost(slug) {
    var p = state.posts.filter(function (x) { return x.slug === slug; })[0];
    if (!p) return;
    if (!confirm('「' + p.title + '」 글을 삭제할까요?\n\n사이트에서 사라지며, 되살리려면 GitHub 기록에서 복구해야 합니다.')) return;
    try {
      var res = await transact('삭제하는 중', async function (ctx) {
        var old = ctx.posts.filter(function (x) { return x.slug === slug; })[0];
        if (!old) throw new Error('이미 삭제된 글입니다. 목록을 새로 고쳐 주세요.');
        var nb = G.neighbors(ctx.posts, slug);
        var posts = ctx.posts.filter(function (x) { return x.slug !== slug; });
        var files = G.buildAll({
          template: ctx.template, newsHtml: ctx.newsHtml, indexHtml: ctx.indexHtml, sitemapXml: ctx.sitemapXml,
          posts: posts, today: todayStr(), only: nb
        });
        files['news/' + slug + '.html'] = null;
        var used = usedImages(posts);
        G.bodyImages(old.body).forEach(function (im) {
          if (!used[im] && ctx.images.indexOf(im) >= 0) files[im] = null;
        });
        return { files: files, posts: posts, message: '소식 삭제: ' + old.title };
      });
      done();
      state.posts = res.out.posts;
      renderList();
      toast('삭제했습니다. 1~3분 뒤 사이트에서도 사라집니다.');
    } catch (e) {
      done();
      toast(e.message || String(e), { err: true });
    }
  }

  /* ── 모든 기사 다시 만들기 ───────────────────────────── */
  async function rebuildAll() {
    if (!confirm('모든 기사 페이지를 지금의 기사 서식으로 다시 만들까요?')) return;
    try {
      var res = await transact('다시 만드는 중', async function (ctx) {
        var files = G.buildAll({
          template: ctx.template, newsHtml: ctx.newsHtml, indexHtml: ctx.indexHtml, sitemapXml: ctx.sitemapXml,
          posts: ctx.posts, today: todayStr()
        });
        return { files: files, posts: ctx.posts, message: '소식 전체 다시 만들기' };
      });
      done();
      state.posts = res.out.posts;
      renderList();
      toast(res.sha ? '다시 만들었습니다. 1~3분 뒤 반영됩니다.' : '바뀐 내용이 없습니다.');
    } catch (e) {
      done();
      toast(e.message || String(e), { err: true });
    }
  }

  /* ── 미리보기 ────────────────────────────────────────── */
  async function preview() {
    var form = readForm(true);
    try {
      if (!state.template) { busy('기사 서식 불러오는 중…'); state.template = await getFile('news/_template.html'); done(); }
    } catch (e) { done(); toast(e.message, { err: true }); return; }
    var old = state.editing;
    var body = form.body == null ? old.body : form.body;
    var slug = old ? old.slug : (form.slug || 'preview');
    var maxNo = state.posts.reduce(function (m, p) { return Math.max(m, p.no || 0); }, 0);
    var post = {
      slug: slug, no: old ? old.no : maxNo + 1, category: form.category,
      title: form.title || '(제목 없음)', deck: form.deck, deckInList: form.deckInList,
      date: form.date || (old && old.date) || todayStr(), updated: todayStr(),
      description: form.description || G.autoDescription(body),
      image: '', imageWidth: 0, imageHeight: 0,
      press: form.pressUrl ? { name: form.pressName || '원문', url: form.pressUrl } : null,
      body: body
    };
    var posts = state.posts.filter(function (p) { return p.slug !== slug; }).concat([post]);
    var chrono = G.chronological(posts);
    var i = chrono.indexOf(post);
    var html = G.renderArticle(state.template, post, chrono[i - 1] || null, chrono[i + 1] || null);
    Object.keys(state.recent).forEach(function (p) { html = html.split('../' + p).join(state.recent[p]); });
    var base = new URL('../news/', location.href).href;
    html = html.replace('<head>', '<head>\n<base href="' + base + '">');
    $('previewFrame').srcdoc = html;
    $('preview').hidden = false;
  }

  /* ── 시작 ────────────────────────────────────────────── */
  function init() {
    setupEditor();
    $('formLogin').addEventListener('submit', function (e) {
      e.preventDefault();
      $('loginErr').hidden = true;
      var t = $('token').value.trim();
      if (!t) { $('loginErr').textContent = '관리 열쇠를 붙여 넣어 주세요.'; $('loginErr').hidden = false; return; }
      login(t, $('remember').checked);
    });
    $('btnLogout').addEventListener('click', logout);
    $('btnNew').addEventListener('click', function () { openEditor(null); });
    $('btnBack').addEventListener('click', backToList);
    $('btnPublish').addEventListener('click', publish);
    $('btnPreview').addEventListener('click', preview);
    $('btnRebuild').addEventListener('click', rebuildAll);
    $('btnClosePreview').addEventListener('click', function () { $('preview').hidden = true; $('previewFrame').srcdoc = ''; });
    document.querySelector('#preview .seg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-w]');
      if (!b) return;
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      $('previewFrame').style.width = b.getAttribute('data-w') + 'px';
    });
    $('listBody').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var slug = b.getAttribute('data-slug');
      if (b.getAttribute('data-act') === 'edit') {
        var p = state.posts.filter(function (x) { return x.slug === slug; })[0];
        if (p) openEditor(p);
      } else {
        removePost(slug);
      }
    });
    ['fCat', 'fTitle', 'fDeck', 'fDeckInList', 'fDate', 'fDesc', 'fPressName', 'fPressUrl', 'fSlug'].forEach(function (id) {
      $(id).addEventListener('input', function () { state.formDirty = true; scheduleDraft(); });
    });
    $('fDesc').addEventListener('input', function () { $('descCount').textContent = String(this.value.length); });
    $('fDate').addEventListener('change', function () {
      // 새 글이고 주소를 손대지 않았다면 날짜에 맞춰 주소 제안
      if (!state.editing && /^\d{8}(-\d+)?$/.test($('fSlug').value)) $('fSlug').value = suggestSlug(this.value);
    });
    window.addEventListener('beforeunload', function (e) {
      if (state.formDirty && !$('viewEdit').hidden) { saveDraft(); e.preventDefault(); e.returnValue = ''; }
    });
    // 탭을 닫거나 다른 앱으로 넘어갈 때도 바로 임시 저장
    window.addEventListener('pagehide', function () { if (state.formDirty) saveDraft(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && state.formDirty) saveDraft(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('preview').hidden) { $('preview').hidden = true; }
    });

    var t = savedToken();
    if (t) { $('remember').checked = !!sget('localStorage', TOKEN_KEY); login(t, $('remember').checked); }
    else show('viewLogin');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
