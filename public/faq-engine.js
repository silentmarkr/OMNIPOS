// ====================================================================
// OMNIPOS FAQ ENGINE — "AI-style" na paghahanap ng sagot sa knowledge
// base (window.OMNIPOS_FAQ_KB), lahat client-side lang, walang
// panlabas/third-party AI API na kinakailangan.
// ====================================================================
// PAANO GUMAGANA (simpleng ipaliwanag):
//   1. Ni-normalize + tino-tokenize ang tanong ng user.
//   2. Pinapalitan muna ang mga kilalang kasingkahulugan (Tagalog <->
//      English POS terms) gamit ang SYNONYMS map, para mas malawak ang
//      pagtugma kahit hindi eksaktong parehong salita ang ginamit.
//   3. Kada entry sa knowledge base, kina-kalkula ang isang "score"
//      base sa dami ng magkatugmang salita sa keywords/question/answer,
//      may extra bigat ang keywords match.
//   4. Ang pinakamataas ang score ang pangunahing sagot; ang susunod na
//      2-3 pinakamalapit na score ang ipapakita bilang "Related Topics".
//   5. Kung wala man lang sapat na tugma, malinaw na sinasabi (hindi
//      nagpapanggap na may alam) at magmumungkahi ng mga topic/category.
// ====================================================================

(function () {
  const STOPWORDS = new Set([
    'ang','ng','sa','mga','ay','na','po','ba','kung','paano','ano','anong',
    'saan','kailan','bakit','pwede','puwede','pano','how','what','where',
    'when','why','can','is','are','the','a','an','to','do','does','i',
    'you','ko','mo','niya','namin','natin','nila','yung','yun','din',
    'rin','lang','lamang','gusto','ko\'ng','para','with','and','or'
  ]);

  // Mga kasingkahulugan / alternative terms na madalas gamitin ng users
  // — pinapalawak nito ang pagtugma nang hindi kailangang isulat lahat
  // ng posibleng salita sa bawat KB entry.
  const SYNONYMS = {
    'benta': ['sale', 'checkout', 'bumili', 'magbenta'],
    'bumili': ['checkout', 'sale', 'benta'],
    'kansela': ['void', 'cancel'],
    'kanselahin': ['void', 'cancel'],
    'imbentaryo': ['inventory', 'stock', 'products'],
    'produkto': ['product', 'item'],
    'user': ['account', 'cashier', 'employee', 'staff'],
    'empleyado': ['user', 'staff', 'employee'],
    'bawal': ['denied', 'restricted', 'permission'],
    'access': ['permission', 'pahintulot'],
    'pahintulot': ['permission', 'access'],
    'binebenta': ['sale', 'checkout'],
    'nawala': ['forgot', 'lost'],
    'nakalimutan': ['forgot'],
    'resibo': ['receipt'],
    'text': ['sms'],
    'email': ['gmail', 'mail'],
    'backup': ['restore', 'reset'],
    'reset': ['backup', 'restore', 'factory reset'],
    'points': ['loyalty', 'rewards'],
    'shift': ['zreading', 'z-reading'],
    'log': ['logs', 'audit', 'history'],
    'role': ['roles', 'permission', 'access level'],
  };

  // Mga pattern na senyales na "yes/no"-type ang tanong ng user (Oo/Hindi/
  // Depende ang hinahanap na sagot), hindi "paano"/"ano"/"saan" na open-ended
  // na tanong. Client-side heuristic lang ito — hindi totoong NLU model —
  // kaya sadyang konserbatibo ito: kapag hindi sigurado, huwag na lang
  // ituring na polar question (mas mabuting walang lumabas na maling
  // "Oo/Hindi" badge kaysa sa nagbibigay ng maling impresyon).
  const POLAR_PATTERNS = [
    /\b(pwede|puwede|maaari|kaya)\s+(ba|bang)\b/,
    /\bpwede\s+ba\b/, /\bpuwede\s+ba\b/,
    /\b(kailangan|dapat|meron|mayroon|may)\s+ba\b/,
    /\b(ligtas|safe|okay|ok|gagana|posible|puwede)\s+(ba)\b/,
    /\bba\?*$/,                              // karaniwang tapos sa "...ba" o "...ba?"
    /^(can|does|do|is|are|will|should|may)\b.*\?\s*$/i,
    /^(can|does|do|is|are|will|should)\b/i
  ];

  function isPolarQuestion(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return false;
    return POLAR_PATTERNS.some(re => re.test(q));
  }

  // Presentasyon ng verdict badge — 'oo' | 'hindi' | 'depende'
  const VERDICT_LABELS = {
    oo: { text: 'Oo', icon: 'fa-circle-check', cls: 'faq-verdict-oo' },
    hindi: { text: 'Hindi', icon: 'fa-circle-xmark', cls: 'faq-verdict-hindi' },
    depende: { text: 'Depende', icon: 'fa-circle-exclamation', cls: 'faq-verdict-depende' }
  };

  function normalize(str) {
    return (str || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(str) {
    return normalize(str)
      .split(' ')
      .filter(w => w.length > 1 && !STOPWORDS.has(w));
  }

  function expandTokens(tokens) {
    const expanded = new Set(tokens);
    tokens.forEach(t => {
      if (SYNONYMS[t]) SYNONYMS[t].forEach(s => expanded.add(s));
    });
    return Array.from(expanded);
  }

  function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Google-style bold highlight ng mga salitang tumugma sa query — tumatanggap
  // ng PLAIN text (hindi pa naka-escape), nagbabalik ng SAFE html string na
  // may <mark> sa mga match. Pinapaikli muna ang tokens paglaki-laki (pinaka-
  // mahabang salita muna) para hindi ma-split ang mas mahabang match ng mas
  // maiksing substring nito.
  function highlight(text, tokens) {
    const escaped = escapeHtml(text || '');
    if (!tokens || !tokens.length) return escaped;
    const uniq = Array.from(new Set(tokens.filter(t => t && t.length > 1)))
      .sort((a, b) => b.length - a.length)
      .map(escapeRegex);
    if (!uniq.length) return escaped;
    const re = new RegExp('(' + uniq.join('|') + ')', 'gi');
    return escaped.replace(re, '<mark>$1</mark>');
  }

  // Bumubuo ng maikling "search snippet" (parang meta-description sa Google)
  // mula sa laman ng sagot — kinukuha ang pinakaunang bahaging may match sa
  // query, para mas kapaki-pakinabang kaysa laging simula lang ng text.
  function buildSnippet(entry, tokens, maxLen) {
    const plain = stripHtml(entry.answer).replace(/\s+/g, ' ').trim();
    maxLen = maxLen || 130;
    let start = 0;
    if (tokens && tokens.length) {
      const lower = plain.toLowerCase();
      for (const t of tokens) {
        const idx = lower.indexOf(t.toLowerCase());
        if (idx !== -1) { start = Math.max(0, idx - 30); break; }
      }
    }
    let snippet = plain.slice(start, start + maxLen);
    if (start > 0) snippet = '…' + snippet;
    if (start + maxLen < plain.length) snippet += '…';
    return highlight(snippet, tokens);
  }

  function slugId(id) {
    return 'faq-full-' + String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  }

  function scoreEntry(entry, queryTokens) {
    const kwText = normalize(entry.keywords.join(' '));
    const qText = normalize(entry.question);
    const aText = normalize(stripHtml(entry.answer));

    let score = 0;
    queryTokens.forEach(tok => {
      if (kwText.includes(tok)) score += 3;      // keywords = pinaka-mahalaga
      if (qText.includes(tok)) score += 2;       // question title
      if (aText.includes(tok)) score += 0.5;     // laman ng sagot
    });

    // Bonus kung halos buong query ay sub-string ng isang keyword phrase
    // (hal. user typed exactly "paano mag void")
    const rawQuery = normalize(queryTokens.join(' '));
    entry.keywords.forEach(k => {
      const nk = normalize(k);
      if (nk.length > 3 && (rawQuery.includes(nk) || nk.includes(rawQuery))) {
        score += 4;
      }
    });

    return score;
  }

  function search(query, limit) {
    const kb = window.OMNIPOS_FAQ_KB || [];
    const tokens = expandTokens(tokenize(query));
    if (tokens.length === 0) return [];

    const scored = kb.map(entry => ({ entry, score: scoreEntry(entry, tokens) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit || 5);
  }

  // Ginagamit para sa "autocomplete"-style suggestions habang nagta-type
  // ang user (bago pa man i-submit ang tanong) — parehong scoring logic
  // ng search(), pero dinideduplicate ayon sa question text at mas mababa
  // ang minimum score threshold (mas maramdamin sa partial typing).
  function suggest(query, limit) {
    const q = (query || '').trim();
    if (q.length < 2) return [];

    const results = search(q, 20);
    const seen = new Set();
    const out = [];
    for (const r of results) {
      if (seen.has(r.entry.id)) continue;
      seen.add(r.entry.id);
      out.push(r.entry);
      if (out.length >= (limit || 6)) break;
    }
    return out;
  }

  // Bumubuo ng "pro"/propesyonal na presentasyon ng sagot — parang isang
  // AI assistant na nag-research bago sumagot, kumpleto ng related topics.
  function renderAnswer(query, container) {
    const results = search(query, 5);

    if (results.length === 0) {
      const categories = Array.from(new Set((window.OMNIPOS_FAQ_KB || []).map(e => e.category)));
      container.innerHTML = `
        <div class="faq-ai-answer faq-ai-noresult">
          <p><i class="fa-solid fa-circle-info"></i> Walang eksaktong nahanap na sagot para sa <strong>"${escapeHtml(query)}"</strong> sa knowledge base ng system.</p>
          <p>Subukan mong gamitin ang ibang salita, o piliin ang isa sa mga sumusunod na topic:</p>
          <div class="faq-ai-chips">
            ${categories.map(c => `<button type="button" class="faq-chip" onclick="OmniFAQ.ask('${escapeHtml(c)}')">${escapeHtml(c)}</button>`).join('')}
          </div>
        </div>`;
      return;
    }

    const top = results[0].entry;
    const related = results.slice(1, 4).map(r => r.entry);

    // Kapag "yes/no"-type ang tanong ng user AT may naka-tag na verdict
    // ang pinaka-tugmang entry, maglagay ng malinaw na Oo/Hindi/Depende
    // badge bago ang buong detalyadong sagot. Kung walang verdict na
    // naka-tag (kahit polar ang tanong), hindi ito nagpapanggap — direkta
    // na lang diretso sa detalyadong sagot para hindi manligaw.
    const verdict = (isPolarQuestion(query) && top.verdict && VERDICT_LABELS[top.verdict])
      ? VERDICT_LABELS[top.verdict] : null;

    container.innerHTML = `
      <div class="faq-ai-answer">
        <div class="faq-ai-badge"><i class="fa-solid fa-wand-magic-sparkles"></i> Sagot batay sa OmniPOS System Knowledge Base</div>
        <div class="faq-ai-breadcrumb">OmniPOS FAQ <i class="fa-solid fa-angle-right"></i> ${escapeHtml(top.category)}</div>
        <h3 class="faq-ai-question">${escapeHtml(top.question)}</h3>
        ${verdict ? `
        <div class="faq-verdict ${verdict.cls}">
          <i class="fa-solid ${verdict.icon}"></i> ${verdict.text}
        </div>` : ''}
        <div class="faq-ai-body">${top.answer}</div>
        <a href="#${slugId(top.id)}" class="faq-ai-sourcelink" data-faq-id="${escapeHtml(top.id)}" data-faq-q="${escapeHtml(top.question)}">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> Buksan sa buong listahan ng FAQ
        </a>
        ${related.length ? `
          <div class="faq-ai-related">
            <strong>Kaugnay na tanong:</strong>
            <ul>
              ${related.map(r => `<li><a href="#${slugId(r.id)}" class="faq-link" data-faq-id="${escapeHtml(r.id)}" data-faq-q="${escapeHtml(r.question)}">${escapeHtml(r.question)}</a></li>`).join('')}
            </ul>
          </div>` : ''}
      </div>`;

    // I-bind ang mga totoong <a href="#faq-full-...">: normal click = mag-
    // navigate papunta sa aktwal na entry sa ibaba (buksan + i-scroll +
    // i-flash), pero HINDI hinaharang ang gitnang-click/ctrl/cmd-click (para
    // gumana pa rin ang "buksan sa bagong tab" gaya ng totoong link).
    container.querySelectorAll('a[data-faq-id]').forEach(a => {
      a.addEventListener('click', (ev) => goTo(a.dataset.faqId, a.dataset.faqQ, ev));
    });
  }

  // --- Autocomplete suggestion dropdown (Google-style, totoong <a> links) ---
  let activeSuggestIndex = -1;

  function renderSuggestions(query) {
    const box = document.getElementById('faq-ai-suggestions');
    if (!box) return;

    const tokens = expandTokens(tokenize(query));
    const matches = suggest(query, 8);
    activeSuggestIndex = -1;

    if (!matches.length) {
      box.innerHTML = '';
      box.style.display = 'none';
      return;
    }

    // Header ng dropdown, gaya ng "Search suggestions" na label ng Google —
    // nililinaw na ito'y totoong resulta mula sa knowledge base, hindi random.
    box.innerHTML = `
      <div class="faq-suggest-header"><i class="fa-solid fa-bolt"></i> Mga tugmang tanong sa knowledge base</div>
      ${matches.map((m, i) => `
      <a href="#${slugId(m.id)}" class="faq-suggest-item" data-index="${i}" data-faq-id="${escapeHtml(m.id)}" data-faq-q="${escapeHtml(m.question)}">
        <span class="faq-suggest-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
        <span class="faq-suggest-main">
          <span class="faq-suggest-title">${highlight(m.question, tokens)}</span>
          <span class="faq-suggest-breadcrumb">OmniPOS FAQ <i class="fa-solid fa-angle-right"></i> ${escapeHtml(m.category)}</span>
          <span class="faq-suggest-desc">${buildSnippet(m, tokens)}</span>
        </span>
        <span class="faq-suggest-go"><i class="fa-solid fa-arrow-right"></i></span>
      </a>`).join('')}`;
    box.style.display = 'block';

    box.querySelectorAll('a.faq-suggest-item').forEach(a => {
      // mousedown-preventDefault: para hindi mawala/ma-blur muna ang input
      // (na siyang nagsasara ng dropdown) BAGO pa man maregister ang click.
      a.addEventListener('mousedown', (ev) => ev.preventDefault());
      a.addEventListener('click', (ev) => goTo(a.dataset.faqId, a.dataset.faqQ, ev));
    });
  }

  function hideSuggestions() {
    const box = document.getElementById('faq-ai-suggestions');
    if (box) { box.innerHTML = ''; box.style.display = 'none'; }
    activeSuggestIndex = -1;
  }

  function moveSuggestion(step) {
    const box = document.getElementById('faq-ai-suggestions');
    if (!box || box.style.display === 'none') return;
    const items = box.querySelectorAll('.faq-suggest-item');
    if (!items.length) return;

    activeSuggestIndex = (activeSuggestIndex + step + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('active', i === activeSuggestIndex));
    items[activeSuggestIndex].scrollIntoView({ block: 'nearest' });
  }

  function confirmActiveSuggestion() {
    const box = document.getElementById('faq-ai-suggestions');
    if (!box || box.style.display === 'none' || activeSuggestIndex < 0) return false;
    const items = box.querySelectorAll('.faq-suggest-item');
    const el = items[activeSuggestIndex];
    if (!el) return false;
    goTo(el.dataset.faqId, el.dataset.faqQ, null);
    return true;
  }

  // --------------------------------------------------------------
  // GO TO / JUMP-TO-SOURCE — ito ang gumagawa ng suggestion dropdown/
  // related-topics links na "totoong link" (parang Google search result):
  //   • may TOTOONG href (#faq-full-<id>) kaya gumagana ang right-click
  //     "open in new tab", middle-click, at Ctrl/Cmd+Click gaya ng
  //     anumang normal na link (HINDI natin hina-hijack ang mga ito).
  //   • sa normal/left click: agad ipinapakita ang mabilisang AI answer
  //     SA ITAAS, TAPOS awtomatikong binubuksan + sini-scroll papunta
  //     + hinihighlight (flash) ang ACTUAL na FAQ entry sa ibaba (ang
  //     "totoong pinagmulan"), kaya konektado talaga ang suggestion sa
  //     tunay na laman — hindi na basta nawawala sa hangin.
  // --------------------------------------------------------------
  function goTo(id, question, event) {
    // Huwag hadlangan ang totoong "buksan sa bagong tab" (middle-click,
    // Ctrl/Cmd+Click) — hayaang sundin ng browser ang default na link
    // behavior gamit ang totoong href.
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1)) {
      return;
    }
    if (event) event.preventDefault();

    hideSuggestions();
    const input = document.getElementById('faq-ai-input');
    const resultBox = document.getElementById('faq-ai-result');
    if (input) input.value = question;
    if (resultBox) {
      renderAnswer(question, resultBox);
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const targetId = slugId(id);
    const target = document.getElementById(targetId);
    if (target) {
      if ('open' in target) target.open = true;
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('faq-item-flash');
        setTimeout(() => target.classList.remove('faq-item-flash'), 1600);
      }, resultBox ? 350 : 0);
    }
    if (history.replaceState) history.replaceState(null, '', '#' + targetId);
  }

  // --------------------------------------------------------------
  // Bumubuo ng "Common Questions" na buong listahan (accordion) DIREKTA
  // mula sa parehong knowledge base (window.OMNIPOS_FAQ_KB) — dati,
  // hiwalay/duplicate na hand-typed na HTML block ito sa index.html na
  // hindi kumokonekta sa AI search/suggestions sa itaas (magkaibang
  // laman pa nga minsan). Ngayon, ISANG source-of-truth na lang ang KB:
  // dito nagmumula ang parehong AI answers, suggestion dropdown, AT ang
  // buong listahan sa ibaba — kaya laging magkatugma sila, at may
  // TOTOONG id (#faq-full-<id>) ang bawat item na puwedeng direktang
  // itarget/i-link ng suggestions.
  // --------------------------------------------------------------
  function renderFullList() {
    const container = document.getElementById('faq-common-list');
    if (!container) return;
    const kb = window.OMNIPOS_FAQ_KB || [];

    let html = '';
    let lastCategory = null;
    kb.forEach(entry => {
      if (entry.category !== lastCategory) {
        html += `<h4 class="faq-cat-heading">${escapeHtml(entry.category)}</h4>`;
        lastCategory = entry.category;
      }
      html += `
        <details class="faq-item" id="${slugId(entry.id)}">
          <summary>${escapeHtml(entry.question)}</summary>
          <div>${entry.answer}</div>
        </details>`;
    });
    container.innerHTML = html;
  }

  // Public API — tinatawag ito mula sa index.html (input box + buttons)
  window.OmniFAQ = {
    ask: function (query) {
      const input = document.getElementById('faq-ai-input');
      const resultBox = document.getElementById('faq-ai-result');
      if (!resultBox) return;
      if (input) input.value = query;
      hideSuggestions();
      if (!query || !query.trim()) {
        resultBox.innerHTML = '';
        return;
      }
      renderAnswer(query.trim(), resultBox);
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    goTo: goTo,
    renderFullList: renderFullList,
    search: search,
    suggest: suggest,
    onInput: function (value) { renderSuggestions(value); },
    onKeyDown: function (event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); moveSuggestion(1); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); moveSuggestion(-1); return; }
      if (event.key === 'Escape') { hideSuggestions(); return; }
      if (event.key === 'Enter') {
        if (confirmActiveSuggestion()) { event.preventDefault(); return; }
        window.OmniFAQ.ask(event.target.value);
      }
    },
    hideSuggestions: hideSuggestions
  };

  // I-render agad ang buong listahan pagka-load ng script (nasa ibaba na ng
  // <body> ang script tags nito, kaya handa na ang DOM). Kung sakaling
  // may direktang naka-link papunta sa isang tanong (hal. #faq-full-...
  // mula sa ibang session/bookmark), i-scroll at buksan ito agad.
  document.addEventListener('DOMContentLoaded', initFullListAndDeepLink);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initFullListAndDeepLink();
  }

  function initFullListAndDeepLink() {
    renderFullList();
    if (location.hash && location.hash.indexOf('#faq-full-') === 0) {
      const target = document.getElementById(location.hash.slice(1));
      if (target && 'open' in target) {
        target.open = true;
        setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
      }
    }
  }
})();
