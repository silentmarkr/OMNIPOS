

(function () {
  const STOPWORDS = new Set([
    'ang','ng','sa','mga','ay','na','po','ba','kung','paano','ano','anong',
    'saan','kailan','bakit','pwede','puwede','pano','how','what','where',
    'when','why','can','is','are','the','a','an','to','do','does','i',
    'you','ko','mo','niya','namin','natin','nila','yung','yun','din',
    'rin','lang','lamang','gusto','ko\'ng','para','with','and','or'
  ]);

  

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

  

  
  
  const POLAR_PATTERNS = [
    /\b(pwede|puwede|maaari|kaya)\s+(ba|bang)\b/,
    /\bpwede\s+ba\b/, /\bpuwede\s+ba\b/,
    /\b(kailangan|dapat|meron|mayroon|may)\s+ba\b/,
    /\b(ligtas|safe|okay|ok|gagana|posible|puwede)\s+(ba)\b/,
    /\bba\?*$/,                              
    /^(can|does|do|is|are|will|should|may)\b.*\?\s*$/i,
    /^(can|does|do|is|are|will|should)\b/i
  ];

  function isPolarQuestion(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return false;
    return POLAR_PATTERNS.some(re => re.test(q));
  }

  const VERDICT_LABELS_BY_LANG = {
    en: {
      oo: { text: 'Yes', icon: 'fa-circle-check', cls: 'faq-verdict-oo' },
      hindi: { text: 'No', icon: 'fa-circle-xmark', cls: 'faq-verdict-hindi' },
      depende: { text: 'Depends', icon: 'fa-circle-exclamation', cls: 'faq-verdict-depende' }
    },
    tl: {
      oo: { text: 'Oo', icon: 'fa-circle-check', cls: 'faq-verdict-oo' },
      hindi: { text: 'Hindi', icon: 'fa-circle-xmark', cls: 'faq-verdict-hindi' },
      depende: { text: 'Depende', icon: 'fa-circle-exclamation', cls: 'faq-verdict-depende' }
    }
  };

  const STRINGS_BY_LANG = {
    en: {
      badge: 'Answer based on the OmniPOS System Knowledge Base',
      breadcrumbRoot: 'OmniPOS FAQ',
      openInList: 'Open in full FAQ list',
      relatedQuestions: 'Related questions:',
      noResultIntro: 'No exact answer found for',
      noResultKb: 'in the system knowledge base.',
      noResultHint: 'Try using different words, or pick one of the following topics:',
      suggestHeader: 'Matching questions in the knowledge base',
      expandAll: 'Expand all',
      collapseAll: 'Collapse all',
      aiModeAi: 'AI Chatbot',
      aiModeKb: 'Search',
      aiModeLockedHint: 'Unlock the AI Assistant for smarter, more natural answers based on this FAQ',
      newConversation: 'New conversation',
      feedbackPrompt: 'Was this helpful?',
      feedbackThanksYes: 'Thanks for the feedback!',
      feedbackThanksNo: 'Thanks — try rephrasing your question, or use the knowledge base results below.',
      copyAnswer: 'Copy',
      copied: 'Copied!',
      regenerate: 'Try again',
      aiThinking: 'AI Assistant is thinking...',
      aiGeneratedBadge: 'AI Assistant answer — based on the OmniPOS FAQ Knowledge Base',
      aiFallbackNotice: 'The AI Assistant is unavailable right now — showing knowledge base search results instead.',
      showKbInstead: 'Show knowledge base results instead',
      followUpsLabel: 'You might also ask:',
      retryIn: 'You can ask again in',
      emptyTitle: 'OmniPOS AI Support Agent',
      emptyBody: 'Ask a question, attach a screenshot, or run a quick diagnostic — I can help troubleshoot, explain errors, and guide you around the system.',
      quickDiagnostics: 'Run diagnostics',
      quickExplainError: 'Explain last error',
      quickTicket: 'Create support ticket',
      diagnosticsQuestion: 'Please run a quick diagnostic check and tell me if anything looks unusual.',
      explainErrorQuestion: 'Can you explain the recent error(s) captured in my browser and what I should do about it?',
      noErrorsCaptured: 'No recent JavaScript errors have been captured in this browser session — that\'s a good sign!',
      creditsLabel: 'AI credits',
      creditsExhausted: 'Monthly AI credits used up for this store. Resets next month.',
      attachRemoved: 'Screenshot removed.',
      goTo: 'Go to',
      ticketModalTitle: 'Create Support Ticket',
      ticketSubjectLabel: 'Subject',
      ticketMessageLabel: 'Describe the issue',
      ticketHint: 'Your current AI conversation and basic device info will be attached automatically to help the developer/admin troubleshoot faster.',
      ticketCancel: 'Cancel',
      ticketSubmit: 'Submit Ticket',
      ticketSubmitting: 'Submitting…',
      ticketSuccess: 'Support ticket submitted! The store admin/developer will follow up.',
      ticketError: 'Could not submit the ticket. Please try again.',
      ticketMissingMessage: 'Please describe the issue first.',
      imageTooLarge: 'That image is too large. Please attach a smaller screenshot (max ~4MB).',
      backToCommon: 'Back to common questions',
      newSearch: 'New search'
    },
    tl: {
      badge: 'Sagot batay sa OmniPOS System Knowledge Base',
      breadcrumbRoot: 'OmniPOS FAQ',
      openInList: 'Buksan sa buong listahan ng FAQ',
      relatedQuestions: 'Kaugnay na tanong:',
      noResultIntro: 'Walang eksaktong nahanap na sagot para sa',
      noResultKb: 'sa knowledge base ng system.',
      noResultHint: 'Subukan mong gamitin ang ibang salita, o piliin ang isa sa mga sumusunod na topic:',
      suggestHeader: 'Mga tugmang tanong sa knowledge base',
      expandAll: 'I-expand lahat',
      collapseAll: 'I-collapse lahat',
      aiModeAi: 'AI Chatbot',
      aiModeKb: 'Search',
      aiModeLockedHint: 'I-unlock ang AI Assistant para sa mas matalino at natural na sagot batay sa FAQ na ito',
      newConversation: 'Bagong usapan',
      feedbackPrompt: 'Nakatulong ba ito?',
      feedbackThanksYes: 'Salamat sa feedback!',
      feedbackThanksNo: 'Salamat — subukan i-ibang salita ang tanong, o gamitin ang resulta ng knowledge base sa ibaba.',
      copyAnswer: 'Kopyahin',
      copied: 'Nakopya!',
      regenerate: 'Subukan ulit',
      aiThinking: 'Iniisip ng AI Assistant ang sagot...',
      aiGeneratedBadge: 'Sagot ng AI Assistant — batay sa OmniPOS FAQ Knowledge Base',
      aiFallbackNotice: 'Hindi available ang AI Assistant sa ngayon — ipinapakita na lang ang resulta ng knowledge base search.',
      showKbInstead: 'Ipakita na lang ang resulta ng knowledge base',
      followUpsLabel: 'Baka gusto mo ring itanong:',
      retryIn: 'Puwede ka nang magtanong ulit pagkalipas ng',
      emptyTitle: 'OmniPOS AI Support Agent',
      emptyBody: 'Magtanong, mag-attach ng screenshot, o mag-run ng quick diagnostic — matutulungan kitang mag-troubleshoot, ipaliwanag ang error, at gabayan sa system.',
      quickDiagnostics: 'Mag-run ng diagnostics',
      quickExplainError: 'Ipaliwanag ang huling error',
      quickTicket: 'Gumawa ng support ticket',
      diagnosticsQuestion: 'Pakisuri ang quick diagnostic at sabihin kung may kakaiba.',
      explainErrorQuestion: 'Pwede mo bang ipaliwanag ang kamakailang error sa browser ko at ano ang dapat kong gawin?',
      noErrorsCaptured: 'Walang na-capture na JavaScript error sa browser session na ito — magandang tanda iyan!',
      creditsLabel: 'AI credits',
      creditsExhausted: 'Naubos na ang buwanang AI credits ng store na ito. Mare-reset sa susunod na buwan.',
      attachRemoved: 'Naalis ang screenshot.',
      goTo: 'Pumunta sa',
      ticketModalTitle: 'Gumawa ng Support Ticket',
      ticketSubjectLabel: 'Paksa',
      ticketMessageLabel: 'Ilarawan ang problema',
      ticketHint: 'Awtomatikong isasama ang kasalukuyang AI conversation at basic device info para mas mabilis matulungan ng developer/admin.',
      ticketCancel: 'Kanselahin',
      ticketSubmit: 'Isumite ang Ticket',
      ticketSubmitting: 'Isinusumite…',
      ticketSuccess: 'Naisumite ang support ticket! Susundan ka ng store admin/developer.',
      ticketError: 'Hindi naisumite ang ticket. Subukan ulit.',
      ticketMissingMessage: 'Pakilarawan muna ang problema.',
      imageTooLarge: 'Masyadong malaki ang larawan. Mag-attach ng mas maliit (max ~4MB).',
      backToCommon: 'Bumalik sa mga karaniwang tanong',
      newSearch: 'Bagong paghahanap'
    }
  };

  function currentLang() {
    return (window.OmniFAQLang && window.OmniFAQLang.get) ? window.OmniFAQLang.get() : 'en';
  }

  function VERDICT_LABELS_FOR(lang) {
    return VERDICT_LABELS_BY_LANG[lang] || VERDICT_LABELS_BY_LANG.en;
  }

  function STRINGS() {
    return STRINGS_BY_LANG[currentLang()] || STRINGS_BY_LANG.en;
  }

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

  function slugCat(cat) {
    return 'faq-cat-' + normalize(cat).replace(/\s+/g, '-');
  }

  // BAGO: typo-tolerant search — sinusukat nito kung gaano "kalapit"
  // (bilang ng insert/delete/substitute na "edits") ang dalawang salita,
  // para makatugma pa rin ang mga typo tulad ng "trasaction" vs
  // "transaction" o "viod" vs "void" sa keyword search (kb mode).
  function levenshtein(a, b) {
    a = a || ''; b = b || '';
    const alen = a.length, blen = b.length;
    if (alen === 0) return blen;
    if (blen === 0) return alen;
    let prevRow = new Array(blen + 1);
    for (let j = 0; j <= blen; j++) prevRow[j] = j;
    for (let i = 1; i <= alen; i++) {
      const currRow = new Array(blen + 1);
      currRow[0] = i;
      for (let j = 1; j <= blen; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        currRow[j] = Math.min(
          prevRow[j] + 1,       // deletion
          currRow[j - 1] + 1,   // insertion
          prevRow[j - 1] + cost // substitution
        );
      }
      prevRow = currRow;
    }
    return prevRow[blen];
  }

  // Mas maluwag ang tolerance para sa mas mahahabang salita (mas
  // maraming letra = mas maraming pagkakataong magkamali), pero
  // huwag i-fuzzy ang napaikling salita dahil madaling magka-false
  // positive doon (hal. "pos" na tumutugma sa "pot").
  function fuzzyTolerance(len) {
    if (len <= 4) return 1;
    if (len <= 8) return 2;
    return 3;
  }

  function isFuzzyMatch(tokenA, tokenB) {
    if (!tokenA || !tokenB || tokenA === tokenB) return false;
    if (Math.max(tokenA.length, tokenB.length) < 4) return false;
    const tolerance = Math.min(fuzzyTolerance(tokenA.length), fuzzyTolerance(tokenB.length));
    return levenshtein(tokenA, tokenB) <= tolerance;
  }

  function scoreEntry(entry, queryTokens) {
    const kwText = normalize(entry.keywords.join(' '));
    const qText = normalize(entry.question);
    const aText = normalize(stripHtml(entry.answer));

    // BAGO: mga token mula sa keywords/question ng entry na ito,
    // gamit sa fuzzy fallback sa ibaba kapag walang eksaktong
    // substring match ang isang query token (posibleng typo).
    const kwTokens = tokenize(entry.keywords.join(' '));
    const qTokens = tokenize(entry.question);

    let score = 0;
    queryTokens.forEach(tok => {
      let exactHit = false;
      if (kwText.includes(tok)) { score += 3; exactHit = true; }
      if (qText.includes(tok)) { score += 2; exactHit = true; }
      if (aText.includes(tok)) { score += 0.5; exactHit = true; }

      // BAGO: typo tolerance — kapag walang eksaktong tugma ang query
      // token na ito, subukang tumugma nang malapit (fuzzy) sa mga
      // salita ng entry. Mas mababa ang idinagdag na score kumpara sa
      // eksaktong tugma, para huwag itong mangibabaw sa tunay na
      // tumpak na resulta — pantulong lang ito kapag walang exact hit.
      if (!exactHit && tok.length >= 4) {
        if (kwTokens.some(kt => isFuzzyMatch(tok, kt))) score += 1.5;
        else if (qTokens.some(qt => isFuzzyMatch(tok, qt))) score += 1;
      }
    });

    
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

  
  // Builds just the "answer body" markup (breadcrumb / question / verdict /
  // body / source link / related list, OR the no-result state) shared by
  // both the classic single-card preview (renderAnswer, used by goTo()) and
  // the chat-bubble knowledge-base fallback (appendKbAnswerBubble, used by
  // OmniFAQ.ask()) — one implementation, two presentations.
  function buildKbAnswerInnerHtml(query) {
    const results = search(query, 5);
    const s = STRINGS();

    if (results.length === 0) {
      const categories = Array.from(new Set((window.OMNIPOS_FAQ_KB || []).map(e => e.category)));
      return `
        <div class="faq-ai-noresult-inner">
          <p><i class="fa-solid fa-circle-info"></i> ${s.noResultIntro} <strong>"${escapeHtml(query)}"</strong> ${s.noResultKb}</p>
          <p>${s.noResultHint}</p>
          <div class="faq-ai-chips">
            ${categories.map(c => `<button type="button" class="faq-chip" onclick="OmniFAQ.ask('${escapeHtml(c)}')">${escapeHtml(c)}</button>`).join('')}
          </div>
        </div>`;
    }

    const top = results[0].entry;
    const related = results.slice(1, 4).map(r => r.entry);
    const lang = currentLang();
    const verdict = (isPolarQuestion(query) && top.verdict && VERDICT_LABELS_FOR(lang)[top.verdict])
      ? VERDICT_LABELS_FOR(lang)[top.verdict] : null;

    return `
      <div class="faq-ai-breadcrumb">${s.breadcrumbRoot} <i class="fa-solid fa-angle-right"></i> ${escapeHtml(top.category)}</div>
      <h3 class="faq-ai-question">${escapeHtml(top.question)}</h3>
      ${verdict ? `
      <div class="faq-verdict ${verdict.cls}">
        <i class="fa-solid ${verdict.icon}"></i> ${verdict.text}
      </div>` : ''}
      <div class="faq-ai-body">${top.answer}</div>
      <a href="#${slugId(top.id)}" class="faq-ai-sourcelink" data-faq-id="${escapeHtml(top.id)}" data-faq-q="${escapeHtml(top.question)}">
        <i class="fa-solid fa-arrow-up-right-from-square"></i> ${s.openInList}
      </a>
      ${related.length ? `
        <div class="faq-ai-related">
          <strong>${s.relatedQuestions}</strong>
          <ul>
            ${related.map(r => `<li><a href="#${slugId(r.id)}" class="faq-link" data-faq-id="${escapeHtml(r.id)}" data-faq-q="${escapeHtml(r.question)}">${escapeHtml(r.question)}</a></li>`).join('')}
          </ul>
        </div>` : ''}`;
  }

  // Classic single-card render — used by goTo() (clicking a specific FAQ
  // link/suggestion should just show that one answer, not join the chat
  // thread). Also clears/resets the chat thread + conversation memory,
  // since navigating away from a chat is effectively starting fresh.
  //
  // BAGO: bagong `opts.showBackLink` — kapag totoo ito (at hindi tayo sa
  // AI Chatbot mode), nagdaragdag ng maliit na "Bumalik sa mga
  // karaniwang tanong" na buton sa itaas ng sagot, para may malinaw at
  // madaling paraan bumalik sa shortcuts/Common Questions na itinatago
  // habang may ipinapakitang resulta (see OmniFAQ.ask() sa ibaba).
  function renderAnswer(query, container, opts) {
    opts = opts || {};
    const s = STRINGS();
    const results = search(query, 5);
    const noResult = results.length === 0;

    const backLinkHtml = (opts.showBackLink && effectiveAiMode() !== 'ai') ? `
      <button type="button" class="faq-chip faq-back-to-common-btn" id="faq-back-to-common-btn">
        <i class="fa-solid fa-arrow-left"></i> ${escapeHtml(s.backToCommon)}
      </button>` : '';

    container.innerHTML = `
      <div class="faq-ai-answer ${noResult ? 'faq-ai-noresult' : ''}">
        ${backLinkHtml}
        <div class="faq-ai-badge"><i class="fa-solid fa-wand-magic-sparkles"></i> ${s.badge}</div>
        ${buildKbAnswerInnerHtml(query)}
      </div>`;

    container.querySelectorAll('a[data-faq-id]').forEach(a => {
      a.addEventListener('click', (ev) => goTo(a.dataset.faqId, a.dataset.faqQ, ev));
    });

    const backBtn = container.querySelector('#faq-back-to-common-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        const input = document.getElementById('faq-ai-input');
        if (input) { input.value = ''; input.focus(); }
        container.innerHTML = '';
        setKbShortcutsVisible(true);
      });
    }
  }

  let activeSuggestIndex = -1;

  function renderSuggestions(query) {
    const box = document.getElementById('faq-ai-suggestions');
    if (!box) return;

    // BAGO: ang "matching questions" dropdown ay para lang sa classic
    // Keyword Search mode. Sa AI Chatbot mode, may sarili nang typing
    // affordance ang composer (send button + Enter para magtanong), kaya
    // nakakaligalig at nagiging masikip ang dropdown na ito kapag pinilit
    // ding ipinapakita doon — lalo na sa mobile (see style.css .faq-suggest-box).
    if (effectiveAiMode() === 'ai') {
      box.innerHTML = '';
      box.style.display = 'none';
      activeSuggestIndex = -1;
      return;
    }

    const tokens = expandTokens(tokenize(query));
    const matches = suggest(query, 8);
    activeSuggestIndex = -1;

    if (!matches.length) {
      box.innerHTML = '';
      box.style.display = 'none';
      return;
    }

    
    box.innerHTML = `
      <div class="faq-suggest-header"><i class="fa-solid fa-bolt"></i> ${STRINGS().suggestHeader}</div>
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

  

  

  

  
  
  function goTo(id, question, event) {

    
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1)) {
      return;
    }
    if (event) event.preventDefault();

    hideSuggestions();
    resetConversation();
    const input = document.getElementById('faq-ai-input');
    const resultBox = document.getElementById('faq-ai-result');
    if (input) input.value = question;
    // BUGFIX: dati, hindi tinatawag dito ang setKbShortcutsVisible(false)
    // (kumpara sa OmniFAQ.ask() sa ibaba) — kaya kapag pumindot ng isang
    // shortcut/"Common Questions" card, sabay na nakikita ang sagot NG
    // card na iyon AT ang buong listahan pa rin ng ibang shortcut sa
    // ilalim/paligid nito. Isa lang dapat makita nang sabay (ang card
    // mismong pinindot) — kaya itinatago na rin dito ang shortcuts, at
    // idinagdag ang showBackLink para may malinaw na paraan bumalik.
    if (effectiveAiMode() !== 'ai') setKbShortcutsVisible(false);
    if (resultBox) {
      renderAnswer(question, resultBox, { showBackLink: true });
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const targetId = slugId(id);
    const target = document.getElementById(targetId);
    if (target) {
      const parentCategory = target.closest('.faq-category');
      if (parentCategory && 'open' in parentCategory) parentCategory.open = true;
      if ('open' in target) target.open = true;
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('faq-item-flash');
        setTimeout(() => target.classList.remove('faq-item-flash'), 1600);
      }, resultBox ? 350 : 0);
    }
    if (history.replaceState) history.replaceState(null, '', '#' + targetId);
  }

  

  

  
  // ===================================================================
  // FULL LIST — grouped into collapsible category accordions (instead of
  // one long flat list) so the FAQ page doesn't require endless scrolling.
  // A toolbar with Expand all / Collapse all + jump-to-category chips is
  // rendered above the list; only the first category starts open.
  // ===================================================================
  function toggleAllCategories(open) {
    document.querySelectorAll('#faq-common-list .faq-category').forEach(el => {
      if ('open' in el) el.open = open;
    });
  }

  function jumpToCategory(catId) {
    const target = document.getElementById(catId);
    if (!target) return;
    if ('open' in target) target.open = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderListToolbar(categories, countsByCategory) {
    const toolbar = document.getElementById('faq-list-toolbar');
    if (!toolbar) return;
    const s = STRINGS();

    toolbar.innerHTML = `
      <div class="faq-toolbar-row">
        <div class="faq-toolbar-actions">
          <button type="button" class="faq-toolbar-btn" id="faq-expand-all-btn"><i class="fa-solid fa-angles-down"></i> ${s.expandAll}</button>
          <button type="button" class="faq-toolbar-btn" id="faq-collapse-all-btn"><i class="fa-solid fa-angles-up"></i> ${s.collapseAll}</button>
        </div>
      </div>
      <div class="faq-cat-chips">
        ${categories.map(c => `<button type="button" class="faq-cat-chip" data-cat-target="${slugCat(c)}">${escapeHtml(c)} <span class="faq-cat-chip-count">${countsByCategory.get(c)}</span></button>`).join('')}
      </div>`;

    const expandBtn = document.getElementById('faq-expand-all-btn');
    const collapseBtn = document.getElementById('faq-collapse-all-btn');
    if (expandBtn) expandBtn.addEventListener('click', () => toggleAllCategories(true));
    if (collapseBtn) collapseBtn.addEventListener('click', () => toggleAllCategories(false));
    toolbar.querySelectorAll('.faq-cat-chip').forEach(btn => {
      btn.addEventListener('click', () => jumpToCategory(btn.dataset.catTarget));
    });
  }

  function renderFullList() {
    const container = document.getElementById('faq-common-list');
    if (!container) return;
    const kb = window.OMNIPOS_FAQ_KB || [];

    const categories = [];
    const byCategory = new Map();
    kb.forEach(entry => {
      if (!byCategory.has(entry.category)) {
        byCategory.set(entry.category, []);
        categories.push(entry.category);
      }
      byCategory.get(entry.category).push(entry);
    });

    const counts = new Map();
    byCategory.forEach((entries, cat) => counts.set(cat, entries.length));
    renderListToolbar(categories, counts);

    let html = '';
    categories.forEach((cat, idx) => {
      const entries = byCategory.get(cat);
      html += `
        <details class="faq-category" id="${slugCat(cat)}" ${idx === 0 ? 'open' : ''}>
          <summary>
            <span class="faq-category-title">${escapeHtml(cat)}</span>
            <span class="faq-category-count">${entries.length}</span>
          </summary>
          <div class="faq-category-body">
            ${entries.map(entry => `
              <details class="faq-item" id="${slugId(entry.id)}">
                <summary>${escapeHtml(entry.question)}</summary>
                <div>${entry.answer}</div>
              </details>`).join('')}
          </div>
        </details>`;
    });
    container.innerHTML = html;
  }

  // ===================================================================
  // AI ASSISTANT (premium module: "ai_assistant")
  // ===================================================================
  // Kapag naka-unlock ang "ai_assistant" module subscription (tingnan sa
  // app.js: isFeatureUnlockedCached/guardPremiumFeature), sinusubukan
  // munang sagutin ng tunay na AI model (via /api/ai-assistant/ask sa
  // server, na tumatawag sa Cloudflare Workers AI) ang tanong ng user,
  // gamit bilang context ang pinaka-tugmang entries mula sa parehong
  // FAQ Knowledge Base (search() sa taas — hindi ito duplicate na
  // knowledge base, kundi retrieval lang bago i-generate ng AI ang
  // sagot). Kung naka-lock, o kung nag-fail/timeout ang AI request,
  // babalik lang ito sa dating keyword-based na renderAnswer() sa
  // ibaba — walang epekto sa mga hindi pa nag-a-upgrade.
  //
  // BAGO: kahit naka-unlock ang subscription, may sariling toggle pa
  // ang user (AI Assistant vs Keyword Search — see renderAiModeToggle)
  // na naka-save sa localStorage, para siya mismo ang pumili kung
  // gagamitin ang AI model o ang dating plain keyword search. Bukod
  // dito, may "memory" na rin ang usapan (chatHistory) para may
  // follow-up questions, at may feedback (👍/👎), copy, at "try again"
  // (regenerate) sa bawat AI-generated na sagot.
  function aiAssistantUnlocked() {
    try {
      return typeof isFeatureUnlockedCached === 'function' && !!isFeatureUnlockedCached('ai_assistant');
    } catch (e) {
      return false;
    }
  }

  const AI_MODE_KEY = 'omnipos_faq_ai_mode';

  function getStoredAiModePref() {
    try {
      const v = localStorage.getItem(AI_MODE_KEY);
      return (v === 'ai' || v === 'kb') ? v : null;
    } catch (e) { return null; }
  }

  function storeAiModePref(mode) {
    try { localStorage.setItem(AI_MODE_KEY, mode); } catch (e) {}
  }

  // The mode actually used: forced to 'kb' when the subscription itself
  // isn't unlocked, otherwise whatever the user picked (defaults to 'ai').
  function effectiveAiMode() {
    if (!aiAssistantUnlocked()) return 'kb';
    return getStoredAiModePref() === 'kb' ? 'kb' : 'ai';
  }

  function renderAiModeToggle() {
    const box = document.getElementById('faq-ai-mode-toggle');
    if (!box) return;
    const s = STRINGS();
    const unlocked = aiAssistantUnlocked();
    const mode = effectiveAiMode();

    if (!unlocked) {
      box.innerHTML = `
        <div class="faq-mode-toggle faq-mode-toggle-locked" data-active="kb">
          <div class="faq-mode-slider"></div>
          <span class="faq-mode-option active"><i class="fa-solid fa-magnifying-glass"></i> ${s.aiModeKb}</span>
          <span class="faq-mode-option faq-mode-locked-option" title="${escapeHtml(s.aiModeLockedHint)}"
                onclick="if (typeof guardPremiumFeature === 'function') guardPremiumFeature('ai_assistant');">
            <i class="fa-solid fa-lock"></i> ${s.aiModeAi}
          </span>
        </div>`;
      return;
    }

    box.innerHTML = `
      <div class="faq-mode-toggle" data-active="${mode}">
        <div class="faq-mode-slider"></div>
        <button type="button" class="faq-mode-option ${mode === 'ai' ? 'active' : ''}" data-mode="ai">
          <i class="fa-solid fa-robot"></i> ${s.aiModeAi}
        </button>
        <button type="button" class="faq-mode-option ${mode === 'kb' ? 'active' : ''}" data-mode="kb">
          <i class="fa-solid fa-magnifying-glass"></i> ${s.aiModeKb}
        </button>
      </div>`;

    box.querySelectorAll('.faq-mode-option[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        storeAiModePref(btn.dataset.mode);
        renderAiModeToggle();
      });
    });

    applyFullChatMode();
    renderQuickActions();
    refreshTicketButtonVisibility();
    refreshAiCreditPill();
  }

  // ---- "modern AI chatbot" full-screen mode ---------------------------
  // When the toggle is set to "AI Chatbot" (mode === 'ai'), hide every
  // classic FAQ list element and turn the AI box into a docked chat
  // screen: only the top bar (language + mode toggle + credits) stays
  // visible above it, matching how modern AI chat apps look.
  function applyFullChatMode() {
    const view = document.getElementById('view-faq');
    if (!view) return;
    const fullchat = effectiveAiMode() === 'ai';
    view.classList.toggle('faq-fullchat-mode', fullchat);
    if (fullchat) restoreChatThreadIfNeeded();
    renderChatEmptyStateIfNeeded();
    updateNewConvoButtonLabel();
    // BAGO: ang shortcuts (Common Questions) ay para lang sa Search
    // mode — palaging nakatago sa AI Chatbot mode. Kapag lumipat
    // papuntang Search mode (o unang beses na nag-load sa mode na ito)
    // nang wala pang aktibong resulta, ipakita ang mga shortcut bilang
    // default na laman ng box.
    if (fullchat) {
      setKbShortcutsVisible(false);
    } else {
      const resultBox = document.getElementById('faq-ai-result');
      const hasActiveResult = !!(resultBox && resultBox.innerHTML.trim());
      setKbShortcutsVisible(!hasActiveResult);
    }
    wireFaqBoxMinHeightSync();
    syncFaqBoxMinHeight();
  }

  function renderChatEmptyStateIfNeeded() {
    const resultBox = document.getElementById('faq-ai-result');
    if (!resultBox) return;
    const fullchat = document.getElementById('view-faq')?.classList.contains('faq-fullchat-mode');
    if (!fullchat) return;
    if (resultBox.querySelector('#faq-chat-thread')) return;
    const s = STRINGS();
    resultBox.innerHTML = `
      <div class="faq-chat-empty-state">
        <i class="fa-solid fa-robot"></i>
        <h4>${escapeHtml(s.emptyTitle)}</h4>
        <p>${escapeHtml(s.emptyBody)}</p>
      </div>`;
  }

  // BAGO: kapag pumasok sa AI Chatbot (fullchat) mode at may naka-save
  // nang usapan mula sa localStorage (chatHistory) pero wala pang
  // ginawang thread ang kasalukuyang page load (hal. bagong refresh),
  // itinatayo ulit dito ang mga bubble mula sa naka-save na usapan sa
  // halip na basta magpakita ng blangkong "empty state". Simpleng
  // teksto lang ang naibabalik (walang badge/feedback buttons/image
  // thumbnail na tulad ng orihinal na sagot) — sapat na ito para
  // makita ng user ang dati niyang tinanong/nasagot habang tuloy pa
  // rin ang follow-up memory (chatHistory mismo ang direktang
  // pinapadala sa AI bilang context).
  function restoreChatThreadIfNeeded() {
    const resultBox = document.getElementById('faq-ai-result');
    if (!resultBox) return;
    if (resultBox.querySelector('#faq-chat-thread')) return;
    if (!chatHistory.length) return;
    const s = STRINGS();
    const thread = ensureThread(resultBox);
    chatHistory.forEach(h => {
      if (h.role === 'user') {
        appendUserBubble(thread, h.text);
      } else {
        appendAssistantBubble(thread, `
          <div class="faq-ai-badge"><i class="fa-solid fa-robot"></i> ${s.aiGeneratedBadge}</div>
          <div class="faq-ai-body" style="white-space:pre-wrap;">${escapeHtml(h.text)}</div>`);
      }
    });
    thread.scrollTop = thread.scrollHeight;
  }

  // BAGO: sa FAQ (parehong AI Chatbot/fullchat AT Search/kb mode) sa
  // mobile, ang composer dock ay dati `position: sticky; bottom: 0`
  // lamang — hindi ito sumusunod nang tama sa aktwal na taas ng
  // on-screen keyboard sa maraming Android/iOS browsers (parehong isyu
  // tulad ng na-encounter na noon sa Login screen, see
  // setupAuthMobileKeyboardHandling sa app.js), kaya minsan naitatago ng
  // keyboard ang input, o na-o-overlap ito ng bottom nav bar
  // (#app-bottom-nav). Dito, ginagaya ang parehong `visualViewport`
  // approach: habang naka-focus sa #faq-ai-input, kino-compute ang
  // overlap ng keyboard at itinatakda bilang CSS var (--faq-kb-offset) na
  // nagbibigay ng extra padding sa ilalim ng composer para lumutang ito
  // nang tama sa ibabaw ng keyboard. Itinatago rin ang bottom nav habang
  // nagta-type (gamit ang parehong .bottom-nav-hidden na ginagamit na sa
  // Terminal view) para hindi ito masamang ka-overlap ng composer.
  //
  // BUGFIX: dati, may `isFullchatActive()` gate dito kaya sa Search (kb)
  // mode lang, kahit iisang #faq-composer-dock ang ginagamit sa
  // dalawang mode, hindi na-a-apply ang keyboard offset — nananatiling
  // naitatago ng keyboard ang search box sa mobile. Inalis na ang gate
  // na ito para gumana ito sa parehong mode.
  let faqKbHandlingWired = false;
  function setupFaqComposerKeyboardHandling() {
    if (faqKbHandlingWired) return;
    faqKbHandlingWired = true;

    const MOBILE_NAV_BREAKPOINT = 1024; // dapat tugma sa .bottom-nav breakpoint sa style.css

    function isMobileNavWidth() {
      return window.innerWidth <= MOBILE_NAV_BREAKPOINT;
    }
    function isComposerFocused() {
      return !!document.activeElement && document.activeElement.id === 'faq-ai-input';
    }

    function updateKeyboardOffset() {
      const view = document.getElementById('view-faq');
      if (!view || !window.visualViewport) return;
      // BUGFIX: dati, dito lang (habang naka-focus pa rin ang input)
      // itinatakda ang --faq-kb-offset — pero ang pag-alis ng
      // 'bottom-nav-hidden'/'faq-kb-active' ay nakadepende LANG sa
      // 'focusout' event sa ibaba. Sa Android, ang pag-dismiss ng
      // on-screen keyboard gamit ang back button/gesture ay HINDI
      // laging nagpapa-fire ng blur/focusout sa input (nananatiling
      // "focused" pa rin ito sa DOM kahit nawala na ang keyboard sa
      // screen) — resulta, hindi na kailanman naibabalik ang bottom
      // nav button (permanenteng nawawala ito, ang na-report na bug).
      // Ang visualViewport resize/scroll event, sa kabilang banda, ay
      // laging tumatak nang tama sa AKTWAL na sukat ng keyboard,
      // kahit paano ito isinara — kaya ginagawa itong DITO (hindi sa
      // focusout) ang tunay na pinagbabatayan kung dapat bang itago o
      // ibalik ang bottom nav/offset.
      if (!isMobileNavWidth()) {
        view.style.removeProperty('--faq-kb-offset');
        view.classList.remove('faq-kb-active');
        return;
      }
      const vv = window.visualViewport;
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const keyboardOpen = overlap > 40 && isComposerFocused();
      if (keyboardOpen) {
        view.style.setProperty('--faq-kb-offset', `${overlap}px`);
        view.classList.add('faq-kb-active');
        const bottomNavEl = document.getElementById('app-bottom-nav');
        if (bottomNavEl) bottomNavEl.classList.add('bottom-nav-hidden');
      } else {
        view.style.removeProperty('--faq-kb-offset');
        view.classList.remove('faq-kb-active');
        restoreBottomNavIfNeeded();
      }
    }

    function restoreBottomNavIfNeeded() {
      const bottomNavEl = document.getElementById('app-bottom-nav');
      if (!bottomNavEl) return;
      // Huwag ibalik kung ang Terminal view mismo ang dahilan kung bakit
      // dapat nakatago ang bottom nav (may sarili itong logic sa switchView).
      const activeItem = document.querySelector('.bottom-nav-item.active');
      const isTerminalView = !!activeItem && activeItem.id === 'bn-terminal';
      if (!isTerminalView) bottomNavEl.classList.remove('bottom-nav-hidden');
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateKeyboardOffset);
      window.visualViewport.addEventListener('scroll', updateKeyboardOffset);
    }

    document.addEventListener('focusin', (ev) => {
      if (!ev.target || ev.target.id !== 'faq-ai-input') return;
      if (!isMobileNavWidth()) return;
      const bottomNavEl = document.getElementById('app-bottom-nav');
      if (bottomNavEl) bottomNavEl.classList.add('bottom-nav-hidden');
      // BUGFIX: dating naiiwan ang +70px na reserved space ng
      // .faq-composer-dock (para sa bottom nav) kahit nakatago na ang
      // bottom nav habang naka-focus ang keyboard — nagreresulta ito sa
      // malaking "patay na puwang" sa pagitan ng search box at ng
      // keyboard (tila lumulutang nang malayo ang composer). Idinaragdag
      // ang klase na ito sa #view-faq para ma-override ng CSS ang
      // bottom offset papuntang 3px lang (tulad ng Fullchat mode) habang
      // aktibo ang keyboard — see style.css .faq-kb-active.
      const view = document.getElementById('view-faq');
      if (view) view.classList.add('faq-kb-active');
      setTimeout(updateKeyboardOffset, 250);
      setTimeout(updateKeyboardOffset, 500);
    });

    document.addEventListener('focusout', (ev) => {
      if (!ev.target || ev.target.id !== 'faq-ai-input') return;
      setTimeout(() => {
        if (isComposerFocused()) return;
        const view = document.getElementById('view-faq');
        if (view) {
          view.style.removeProperty('--faq-kb-offset');
          view.classList.remove('faq-kb-active');
        }
        restoreBottomNavIfNeeded();
      }, 150);
    });
  }

  // BUGFIX: sa Search (kb) mode, dating umaasa lang sa position:sticky
  // ang .faq-composer-dock para "pumako" sa ilalim ng screen — pero
  // hindi ito gumagana kapag mas maikli ang laman ng .faq-ai-box kaysa
  // sa buong natitirang taas ng viewport (hal. walang pang resulta,
  // "Common Questions" lang, o unang beses na lumipat mula AI Chatbot
  // papuntang Search mode). Sa ganitong sitwasyon, agad na lang
  // natatapat ang search box sa ibaba ng maikling laman na iyon —
  // malaking patay na puwang ang natitira sa ibaba (ito ang
  // na-report na bug). Dito, sinusukat ng JS ang available na taas
  // mula sa itaas ng .faq-ai-box hanggang sa tunay na ilalim ng
  // viewport, at itinatakda bilang min-height ng box (kasabay ng
  // display:flex sa style.css) para laging maabot ng composer-dock
  // ang tunay na ibaba.
  function syncFaqBoxMinHeight() {
    const view = document.getElementById('view-faq');
    const box = document.getElementById('faq-ai-box');
    if (!view || !box) return;
    if (view.style.display === 'none' || view.classList.contains('faq-fullchat-mode')) {
      box.style.removeProperty('min-height');
      return;
    }
    if (box.offsetParent === null) return; // hindi pa talaga nakikita
    const top = box.getBoundingClientRect().top;
    // tugma sa reserved bottom offset na ginagamit na ng .faq-composer-dock
    // mismo (see @media max-width:1024px sa itaas), plus maliit na buffer.
    const bottomReserve = window.innerWidth <= 1024 ? 76 : 6;
    const available = Math.round(window.innerHeight - top - bottomReserve);
    box.style.minHeight = available > 0 ? `${available}px` : '';
  }

  let faqBoxMinHeightWired = false;
  function wireFaqBoxMinHeightSync() {
    if (faqBoxMinHeightWired) return;
    faqBoxMinHeightWired = true;
    window.addEventListener('resize', syncFaqBoxMinHeight);
    window.addEventListener('orientationchange', syncFaqBoxMinHeight);
    if (typeof window.switchView === 'function') {
      const originalSwitchView = window.switchView;
      window.switchView = function (viewKey, opts) {
        const result = originalSwitchView.apply(this, arguments);
        setTimeout(syncFaqBoxMinHeight, 0);
        return result;
      };
    }
  }

  let slashShortcutWired = false;
  function setupSlashShortcut() {
    if (slashShortcutWired) return;
    slashShortcutWired = true;
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const view = document.getElementById('view-faq');
      if (!view || view.style.display === 'none') return;
      const active = document.activeElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (isTyping) return;
      const input = document.getElementById('faq-ai-input');
      if (input) { ev.preventDefault(); input.focus(); }
    });
  }

  // ---- conversational memory + chat-thread rendering ------------------

  // BAGO: persisted chat history — dating naka-memory lang sa variable
  // na ito ang buong usapan (nawawala pag na-refresh ang page). Ngayon,
  // naka-save din ito sa localStorage kaya pag bumalik ang user sa FAQ
  // (AI Chatbot mode) matapos mag-refresh o muling magbukas ng app,
  // ipinapakita pa rin ang dating usapan sa halip na basta magsisimula
  // sa blangkong estado — see saveChatHistory() / restoreChatThreadIfNeeded()
  // sa ibaba.
  const CHAT_HISTORY_KEY = 'omnipos_faq_chat_history';
  const CHAT_HISTORY_MAX = 40; // limitahan ang laki ng na-se-save sa localStorage

  function loadStoredChatHistory() {
    try {
      const raw = localStorage.getItem(CHAT_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string');
    } catch (e) { return []; }
  }

  function saveChatHistory() {
    try { localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatHistory.slice(-CHAT_HISTORY_MAX))); } catch (e) {}
  }

  function clearStoredChatHistory() {
    try { localStorage.removeItem(CHAT_HISTORY_KEY); } catch (e) {}
  }

  let chatHistory = loadStoredChatHistory();   // [{role:'user'|'assistant', text}] —
                           // sent to the server as short-term context for
                           // follow-ups, at naka-save din sa localStorage.

  // ---- "Common Questions" shortcuts panel (Search/kb mode only) --------
  // BAGO: sa Search mode, ang mga shortcut/karaniwang tanong ay
  // nakatira na sa LOOB mismo ng .faq-ai-box (see index.html:
  // #faq-kb-shortcuts) — ipinapakita ito bilang default, at itinatago
  // habang may aktibong resulta na ipinapakita mula sa isang
  // tinanong/hinanap na query (see OmniFAQ.ask()). Palaging nakatago
  // ito sa AI Chatbot (fullchat) mode — see style.css.
  function setKbShortcutsVisible(visible) {
    const shortcuts = document.getElementById('faq-kb-shortcuts');
    if (shortcuts) shortcuts.style.display = visible ? '' : 'none';
  }

  function updateNewConvoButtonLabel() {
    const textEl = document.getElementById('faq-new-convo-text');
    if (!textEl) return;
    const s = STRINGS();
    textEl.textContent = effectiveAiMode() === 'ai' ? s.newConversation : s.newSearch;
  }

  function resetConversation() {
    chatHistory = [];
    clearStoredChatHistory();
    const resultBox = document.getElementById('faq-ai-result');
    if (resultBox) resultBox.innerHTML = '';
    clearImage();
    renderChatEmptyStateIfNeeded();
    // BAGO: sa Search (kb) mode, ang "bagong usapan/search" ay ibig
    // sabihin lang ay ibalik ang mga shortcut/Common Questions sa loob
    // ng box at i-clear ang laman ng search field — walang "chat
    // thread" na kailangang panatilihin dahil single-turn lang talaga
    // ang keyword search (hindi ito multi-turn na kausap-ang-AI).
    if (effectiveAiMode() !== 'ai') {
      const input = document.getElementById('faq-ai-input');
      if (input) input.value = '';
      setKbShortcutsVisible(true);
    }
  }

  function ensureThread(container) {
    let thread = container.querySelector('#faq-chat-thread');
    if (!thread) {
      container.innerHTML = '<div class="faq-chat-thread" id="faq-chat-thread"></div>';
      thread = container.querySelector('#faq-chat-thread');
    }
    return thread;
  }

  function appendUserBubble(thread, text) {
    const div = document.createElement('div');
    div.className = 'faq-chat-msg faq-chat-user';
    div.innerHTML = `<div class="faq-chat-bubble">${escapeHtml(text)}</div>`;
    thread.appendChild(div);
    return div;
  }

  function appendAssistantBubble(thread, innerHtml) {
    const div = document.createElement('div');
    div.className = 'faq-chat-msg faq-chat-assistant';
    div.innerHTML = `<div class="faq-chat-bubble">${innerHtml}</div>`;
    thread.appendChild(div);
    return div;
  }

  function wireBubbleFaqLinks(bubbleEl) {
    bubbleEl.querySelectorAll('a[data-faq-id]').forEach(a => {
      a.addEventListener('click', (ev) => goTo(a.dataset.faqId, a.dataset.faqQ, ev));
    });
  }

  function appendKbAnswerBubble(query, thread, wasAiAttempted) {
    const s = STRINGS();
    const html = `
      ${wasAiAttempted ? `
        <div class="faq-ai-fallback-notice">
          <div class="faq-ai-fallback-msg"><i class="fa-solid fa-triangle-exclamation"></i> ${s.aiFallbackNotice}</div>
          <button type="button" class="faq-chip faq-retry-ai-btn" data-action="retry-ai">
            <i class="fa-solid fa-arrow-rotate-right"></i> ${s.regenerate}
          </button>
        </div>` : ''}
      <div class="faq-ai-badge"><i class="fa-solid fa-wand-magic-sparkles"></i> ${s.badge}</div>
      ${buildKbAnswerInnerHtml(query)}`;
    const bubble = appendAssistantBubble(thread, html);
    wireBubbleFaqLinks(bubble);
    chatHistory.push({ role: 'assistant', text: stripHtml(buildKbAnswerInnerHtml(query)).slice(0, 500) });
    saveChatHistory();
    // BAGO: "Try again" button — kapag nag-fail ang AI Assistant at
    // bumalik na lang sa keyword-based na sagot, dating tahimik lang
    // itong tinatanggap; ngayon, may malinaw na buton para subukan
    // ulit ang AI (hindi lang basta tanggapin ang KB fallback).
    if (wasAiAttempted) wireKbFallbackRetryAction(bubble, query, thread);
    return bubble;
  }

  function wireKbFallbackRetryAction(bubble, query, thread) {
    const bubbleInner = bubble.querySelector('.faq-chat-bubble');
    const retryBtn = bubbleInner && bubbleInner.querySelector('[data-action="retry-ai"]');
    if (!retryBtn) return;
    retryBtn.addEventListener('click', async () => {
      // Alisin ang stale na KB-fallback na assistant turn bago subukan
      // ulit ang AI — parehong approach sa "Try again"/regenerate
      // button ng matagumpay na AI answers (see wireAiBubbleActions).
      if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'assistant') {
        chatHistory.pop();
      }
      saveChatHistory();
      bubble.remove();
      setSendButtonLoading(true);
      try {
        const handled = await askAIAssistantChat(query, thread);
        if (!handled) appendKbAnswerBubble(query, thread, true);
      } finally {
        setSendButtonLoading(false);
      }
      saveChatHistory();
      thread.scrollTop = thread.scrollHeight;
    });
  }

  function wireAiBubbleActions(bubble, query, answerText, thread) {
    const s = STRINGS();
    const bubbleInner = bubble.querySelector('.faq-chat-bubble');

    const copyBtn = bubbleInner.querySelector('[data-action="copy"]');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(answerText);
          const label = copyBtn.querySelector('.faq-action-label');
          const original = label ? label.textContent : null;
          if (label) label.textContent = s.copied;
          setTimeout(() => { if (label && original !== null) label.textContent = original; }, 1500);
        } catch (e) {}
      });
    }

    const regenBtn = bubbleInner.querySelector('[data-action="regenerate"]');
    if (regenBtn) {
      regenBtn.addEventListener('click', () => {
        // Drop the stale assistant turn from memory, then re-ask.
        if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'assistant') {
          chatHistory.pop();
        }
        saveChatHistory();
        bubble.remove();
        askAIAssistantChat(query, thread).then(saveChatHistory);
      });
    }

    const feedbackEl = bubbleInner.querySelector('.faq-feedback');
    if (feedbackEl) {
      feedbackEl.querySelectorAll('.faq-feedback-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          feedbackEl.querySelectorAll('.faq-feedback-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const label = feedbackEl.querySelector('.faq-feedback-label');
          if (label) label.textContent = btn.dataset.vote === 'up' ? s.feedbackThanksYes : s.feedbackThanksNo;
          feedbackEl.querySelectorAll('.faq-feedback-btn').forEach(b => b.disabled = true);
          if (btn.dataset.vote === 'down') {
            const linkWrap = document.createElement('div');
            linkWrap.className = 'faq-feedback-fallback-link';
            linkWrap.innerHTML = `<button type="button" class="faq-chip">${escapeHtml(s.showKbInstead)}</button>`;
            linkWrap.querySelector('button').addEventListener('click', () => appendKbAnswerBubble(query, thread, false));
            feedbackEl.appendChild(linkWrap);
          }
        });
      });
    }
  }

  function typeWriterReveal(bodyEl, fullText, onDone) {
    bodyEl.style.whiteSpace = 'pre-wrap';
    const words = fullText.split(/(\s+)/);
    let i = 0;
    (function step() {
      if (i >= words.length) { onDone(); return; }
      // Reveal a few words at a time for a natural-feeling but snappy pace.
      bodyEl.textContent += words.slice(i, i + 2).join('');
      i += 2;
      setTimeout(step, 18);
    })();
  }

  function renderFollowUpChips(container, candidates, askedQuestion, thread) {
    const s = STRINGS();
    const suggestions = candidates
      .filter(c => c.question && c.question.trim().toLowerCase() !== askedQuestion.trim().toLowerCase())
      .slice(0, 3);
    if (!suggestions.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'faq-followup-chips';
    wrap.innerHTML = `<span class="faq-followup-label">${s.followUpsLabel}</span>`;
    suggestions.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'faq-chip faq-followup-chip';
      btn.textContent = c.question;
      btn.addEventListener('click', () => window.OmniFAQ.ask(c.question));
      wrap.appendChild(btn);
    });
    container.appendChild(wrap);
  }

  // ---- lightweight client-side error capture (for the "explain last
  // error" / diagnostic assistant quick action) — keeps only the last
  // few messages in memory, never sent anywhere unless the user
  // explicitly taps "Explain last error" or "Run diagnostics". ----
  const CAPTURED_ERRORS = [];
  const MAX_CAPTURED_ERRORS = 5;
  function captureClientError(text) {
    if (!text) return;
    CAPTURED_ERRORS.unshift(String(text).slice(0, 400));
    if (CAPTURED_ERRORS.length > MAX_CAPTURED_ERRORS) CAPTURED_ERRORS.length = MAX_CAPTURED_ERRORS;
  }
  window.addEventListener('error', (ev) => {
    captureClientError(`${ev.message || 'Unknown error'} (${ev.filename ? ev.filename.split('/').pop() : 'unknown file'}:${ev.lineno || '?'})`);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev && ev.reason;
    captureClientError(`Unhandled promise rejection: ${reason && reason.message ? reason.message : reason}`);
  });

  function gatherDiagnostics() {
    let currentView = null;
    try {
      const active = document.querySelector('.app-view:not([style*="display: none"])');
      currentView = active ? active.id : null;
    } catch (e) {}
    return {
      currentView,
      appVersion: (window.OMNIPOS_APP_VERSION || document.querySelector('meta[name="app-version"]')?.content || null),
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      localTime: new Date().toString()
    };
  }

  // ---- image attachment (screenshot assistant) -------------------------
  let pendingImageDataUrl = null;
  function triggerAttach() {
    document.getElementById('faq-ai-image-input')?.click();
  }
  function onImageSelected(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const s = STRINGS();
    if (file.size > 4.5 * 1024 * 1024) {
      alert(s.imageTooLarge);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingImageDataUrl = reader.result;
      const wrap = document.getElementById('faq-image-preview-wrap');
      const img = document.getElementById('faq-image-preview');
      if (img) img.src = pendingImageDataUrl;
      if (wrap) wrap.style.display = 'inline-block';
      document.getElementById('faq-attach-btn')?.classList.add('has-attachment');
    };
    reader.readAsDataURL(file);
  }
  function clearImage() {
    pendingImageDataUrl = null;
    const wrap = document.getElementById('faq-image-preview-wrap');
    if (wrap) wrap.style.display = 'none';
    document.getElementById('faq-attach-btn')?.classList.remove('has-attachment');
  }

  // ---- AI credit/billing pill (top bar) ---------------------------------
  async function refreshAiCreditPill(preloaded) {
    const pill = document.getElementById('ai-assistant-credit-pill');
    if (!pill) return;
    if (!aiAssistantUnlocked()) { pill.style.display = 'none'; return; }
    const s = STRINGS();
    try {
      const data = preloaded || await (async () => {
        const res = await authFetch(`${API_URL}/ai-assistant/usage`);
        return res.ok ? res.json() : null;
      })();
      // NOTE: kapag preloaded (galing sa 402 creditsExhausted response ng
      // /ai-assistant/ask), `data.success` ay laging false kahit valid at
      // kumpleto naman ang remaining/limit fields nito — kaya HINDI dapat
      // ibase ang pagtago ng pill sa `success` field, kundi sa aktwal na
      // pagkakaroon ng usable na remaining/limit numbers. Dating bug: dahil
      // sa success===false check, natatago ang credit pill sa halip na
      // ipakita bilang "exhausted" — kabaligtaran ng sinasadya.
      if (!data || typeof data.remaining !== 'number' || typeof data.limit !== 'number') {
        pill.style.display = 'none';
        return;
      }
      const remaining = data.remaining;
      const limit = data.limit;
      pill.style.display = 'inline-flex';
      pill.classList.toggle('low', limit > 0 && remaining / limit <= 0.15 && remaining > 0);
      pill.classList.toggle('exhausted', remaining <= 0);
      pill.innerHTML = `<i class="fa-solid fa-bolt"></i> ${escapeHtml(s.creditsLabel)}: ${remaining}/${limit}`;
    } catch (e) {
      pill.style.display = 'none';
    }
  }

  // ---- quick action chips (diagnostic assistant / error explainer /
  // support-ticket assistant) --------------------------------------------
  function renderQuickActions() {
    const box = document.getElementById('faq-quick-actions');
    if (!box) return;
    if (!aiAssistantUnlocked() || effectiveAiMode() !== 'ai') { box.innerHTML = ''; return; }
    const s = STRINGS();
    box.innerHTML = `
      <button type="button" class="faq-quick-action-chip" data-quick="diagnostics"><i class="fa-solid fa-stethoscope"></i> ${escapeHtml(s.quickDiagnostics)}</button>
      <button type="button" class="faq-quick-action-chip" data-quick="explain-error"><i class="fa-solid fa-bug"></i> ${escapeHtml(s.quickExplainError)}</button>
      <button type="button" class="faq-quick-action-chip" data-quick="ticket"><i class="fa-solid fa-life-ring"></i> ${escapeHtml(s.quickTicket)}</button>`;
    box.querySelectorAll('[data-quick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.quick;
        if (kind === 'diagnostics') { pendingDiagnosticsRequested = true; window.OmniFAQ.ask(STRINGS().diagnosticsQuestion); }
        else if (kind === 'explain-error') { pendingDiagnosticsRequested = true; window.OmniFAQ.ask(STRINGS().explainErrorQuestion); }
        else if (kind === 'ticket') { openTicketModal(); }
      });
    });
  }
  let pendingDiagnosticsRequested = false;

  function refreshTicketButtonVisibility() {
    const btn = document.getElementById('faq-ticket-btn');
    // BAGO: naka-tali ang Support Ticket sa "kasalukuyang AI
    // conversation" (see ticketHint), kaya walang saysay ipakita ito sa
    // Search (kb) mode kung saan wala namang multi-turn na usapan.
    if (btn) btn.style.display = (aiAssistantUnlocked() && effectiveAiMode() === 'ai') ? 'inline-flex' : 'none';
  }

  // ---- suggested "safe action" chips (navigate only, never a
  // data-changing action) under an AI answer ------------------------------
  function renderSuggestedActions(container, actions) {
    if (!Array.isArray(actions) || !actions.length) return;
    const s = STRINGS();
    const wrap = document.createElement('div');
    wrap.className = 'faq-suggested-actions';
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'faq-suggested-action-btn';
      btn.innerHTML = `<i class="fa-solid fa-arrow-right"></i> ${escapeHtml(s.goTo)} ${escapeHtml(a.label || a.view)}`;
      btn.addEventListener('click', () => {
        if (typeof window.switchView === 'function') window.switchView(a.view);
      });
      wrap.appendChild(btn);
    });
    container.appendChild(wrap);
  }

  // ---- support ticket modal ---------------------------------------------
  function openTicketModal() {
    const backdrop = document.getElementById('faq-ticket-modal-backdrop');
    if (!backdrop) return;
    const s = STRINGS();
    document.getElementById('faq-ticket-modal-title').textContent = s.ticketModalTitle;
    document.getElementById('faq-ticket-subject-label').textContent = s.ticketSubjectLabel;
    document.getElementById('faq-ticket-message-label').textContent = s.ticketMessageLabel;
    document.getElementById('faq-ticket-hint').textContent = s.ticketHint;
    document.getElementById('faq-ticket-cancel-text').textContent = s.ticketCancel;
    document.getElementById('faq-ticket-submit-text').textContent = s.ticketSubmit;
    const lastQuestion = chatHistory.filter(h => h.role === 'user').slice(-1)[0];
    document.getElementById('faq-ticket-subject').value = lastQuestion ? lastQuestion.text.slice(0, 150) : '';
    document.getElementById('faq-ticket-message').value = '';
    backdrop.style.display = 'flex';
    setTimeout(() => document.getElementById('faq-ticket-message')?.focus(), 50);
  }
  function closeTicketModal() {
    const backdrop = document.getElementById('faq-ticket-modal-backdrop');
    if (backdrop) backdrop.style.display = 'none';
  }
  async function submitTicket() {
    const s = STRINGS();
    const subjectEl = document.getElementById('faq-ticket-subject');
    const messageEl = document.getElementById('faq-ticket-message');
    const message = (messageEl?.value || '').trim();
    if (!message && !chatHistory.length) {
      alert(s.ticketMissingMessage);
      return;
    }
    const submitBtn = document.getElementById('faq-ticket-submit-btn');
    const submitText = document.getElementById('faq-ticket-submit-text');
    const originalLabel = submitText ? submitText.textContent : '';
    if (submitBtn) submitBtn.disabled = true;
    if (submitText) submitText.textContent = s.ticketSubmitting;
    try {
      const res = await authFetch(`${API_URL}/support-tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subjectEl?.value || '',
          message,
          transcript: chatHistory,
          diagnostics: gatherDiagnostics()
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) {
        alert((data && data.message) || s.ticketError);
        return;
      }
      closeTicketModal();
      if (window.Swal && typeof window.Swal.fire === 'function') {
        window.Swal.fire({ icon: 'success', title: s.ticketSuccess, timer: 2200, showConfirmButton: false });
      } else {
        alert(s.ticketSuccess);
      }
    } catch (e) {
      alert(s.ticketError);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (submitText) submitText.textContent = originalLabel;
    }
  }

  async function askAIAssistantChat(query, thread) {
    const lang = currentLang();
    const s = STRINGS();

    const loadingBubble = appendAssistantBubble(thread, `
      <div class="faq-ai-badge faq-ai-thinking"><i class="fa-solid fa-robot fa-spin"></i> ${s.aiThinking}</div>`);

    const candidates = search(query, 6).map(r => ({
      question: r.entry.question,
      answer: stripHtml(r.entry.answer).slice(0, 900)
    }));
    // Short-term memory sent to the server so the AI can handle natural
    // follow-up questions ("paano kung hindi gumana yun?") without the
    // user needing to repeat context — excludes the current question
    // itself, which is sent separately as the primary "question" field.
    const historyPayload = chatHistory.slice(0, -1).slice(-8).map(h => ({ role: h.role, text: h.text }));

    const imageToSend = pendingImageDataUrl;
    const wantsDiagnostics = pendingDiagnosticsRequested;
    pendingDiagnosticsRequested = false;
    clearImage();

    try {
      const res = await authFetch(`${API_URL}/ai-assistant/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: query,
          lang,
          context: candidates,
          history: historyPayload,
          image: imageToSend || undefined,
          diagnostics: wantsDiagnostics ? gatherDiagnostics() : undefined,
          clientErrors: wantsDiagnostics ? (CAPTURED_ERRORS.length ? CAPTURED_ERRORS : [s.noErrorsCaptured]) : undefined
        }),
        timeoutMs: 30000
      });
      const data = await res.json().catch(() => null);

      // AI credit/billing: monthly quota exhausted — offer a support
      // ticket instead of silently failing.
      if (res.status === 402 && data && data.creditsExhausted) {
        refreshAiCreditPill(data);
        loadingBubble.querySelector('.faq-chat-bubble').innerHTML = `
          <div class="faq-ai-fallback-notice"><i class="fa-solid fa-battery-empty"></i>
            <span>${escapeHtml(data.message || s.creditsExhausted)}</span>
          </div>
          <button type="button" class="faq-chip" id="faq-credit-exhausted-ticket-btn"><i class="fa-solid fa-life-ring"></i> ${escapeHtml(s.quickTicket)}</button>`;
        loadingBubble.querySelector('#faq-credit-exhausted-ticket-btn')?.addEventListener('click', openTicketModal);
        if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'user') chatHistory.pop();
        return true;
      }

      // Rate limit: be transparent about it instead of silently falling
      // back to keyword search (which would look like the AI just "didn't
      // know" the answer). Shows a live countdown using Retry-After.
      if (res.status === 429) {
        const retryAfterHeader = parseInt(res.headers.get('Retry-After'), 10);
        let secondsLeft = Number.isFinite(retryAfterHeader) ? retryAfterHeader : null;
        const msg = (data && data.message) || '';
        loadingBubble.querySelector('.faq-chat-bubble').innerHTML = `
          <div class="faq-ai-fallback-notice"><i class="fa-solid fa-hourglass-half"></i>
            <span class="faq-ratelimit-msg">${escapeHtml(msg)}</span>
            ${secondsLeft !== null ? `<span class="faq-ratelimit-countdown"> — ${s.retryIn} <strong><span id="faq-retry-secs">${secondsLeft}</span>s</strong></span>` : ''}
          </div>`;
        if (secondsLeft !== null) {
          const counterEl = loadingBubble.querySelector('#faq-retry-secs');
          const timer = setInterval(() => {
            secondsLeft -= 1;
            if (counterEl) counterEl.textContent = Math.max(0, secondsLeft);
            if (secondsLeft <= 0) clearInterval(timer);
          }, 1000);
        }
        if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'user') chatHistory.pop();
        return true;
      }

      if (!res.ok || !data || data.success === false) {
        if (data && data.featureLocked && typeof guardPremiumFeature === 'function') {
          guardPremiumFeature('ai_assistant');
        }
        loadingBubble.remove();
        return false;
      }

      const answerText = (data.answer || '').trim();
      if (!answerText) { loadingBubble.remove(); return false; }

      chatHistory.push({ role: 'assistant', text: answerText.slice(0, 500) });
      if (data.credits) refreshAiCreditPill(data.credits);

      const bubbleInner = loadingBubble.querySelector('.faq-chat-bubble');
      bubbleInner.innerHTML = `<div class="faq-ai-badge"><i class="fa-solid fa-robot"></i> ${s.aiGeneratedBadge}</div>`;
      const bodyEl = document.createElement('div');
      bodyEl.className = 'faq-ai-body';
      bubbleInner.appendChild(bodyEl);

      typeWriterReveal(bodyEl, answerText, () => {
        const actions = document.createElement('div');
        actions.className = 'faq-chat-actions';
        actions.innerHTML = `
          <button type="button" class="faq-chat-action-btn" data-action="copy">
            <i class="fa-solid fa-copy"></i> <span class="faq-action-label">${s.copyAnswer}</span>
          </button>
          <button type="button" class="faq-chat-action-btn" data-action="regenerate">
            <i class="fa-solid fa-arrow-rotate-right"></i> <span class="faq-action-label">${s.regenerate}</span>
          </button>
          <span class="faq-feedback">
            <span class="faq-feedback-label">${s.feedbackPrompt}</span>
            <button type="button" class="faq-feedback-btn" data-vote="up" title="${escapeHtml(s.feedbackPrompt)}"><i class="fa-solid fa-thumbs-up"></i></button>
            <button type="button" class="faq-feedback-btn" data-vote="down" title="${escapeHtml(s.feedbackPrompt)}"><i class="fa-solid fa-thumbs-down"></i></button>
          </span>`;
        bubbleInner.appendChild(actions);
        wireAiBubbleActions(loadingBubble, query, answerText, thread);
        renderSuggestedActions(bubbleInner, data.suggestedActions);
        renderFollowUpChips(bubbleInner, candidates, query, thread);
        thread.scrollTop = thread.scrollHeight;
      });
      return true;
    } catch (err) {
      loadingBubble.remove();
      return false;
    }
  }

  // BAGO: habang nag-lo-load ang AI (fullchat) response, pinapalitan ang
  // arrow-up icon ng send button ng umiikot na AI/robot icon, para
  // malinaw sa user na aktibong ginagana ang AI — bumabalik sa dati
  // (arrow-up) at naka-enable ulit ang buton pagkatapos, tagumpay man
  // o nag-fail ang request (see try/finally sa OmniFAQ.ask()).
  function setSendButtonLoading(loading) {
    const btn = document.getElementById('faq-send-btn');
    if (!btn) return;
    const icon = btn.querySelector('i');
    if (!icon) return;
    if (loading) {
      icon.className = 'fa-solid fa-robot fa-spin';
      btn.disabled = true;
    } else {
      icon.className = 'fa-solid fa-arrow-up';
      btn.disabled = false;
    }
  }

  window.OmniFAQ = {
    ask: async function (query) {
      const input = document.getElementById('faq-ai-input');
      const resultBox = document.getElementById('faq-ai-result');
      if (!resultBox) return;
      if (input) input.value = query;
      hideSuggestions();
      const q = (query || '').trim();
      if (!q) return;

      // BAGO: laging binubura ang laman ng text box sa bawat successful
      // na send — dati, naiiwan ang huling pinadalang tanong sa loob ng
      // input (o kahit anong natira doon mula sa suggestion click),
      // kaya kailangan pang i-manual clear ito bago makapag-type ulit.
      // Gumagana ito sa parehong AI Chatbot at Search mode dahil iisang
      // ask() function ito ang tinatawag ng dalawa.
      if (input) input.value = '';

      const mode = effectiveAiMode();

      // BAGO: sa Search (kb) mode, isang beses lang dapat magpakita ng
      // SINGLE na sagot (parang search result) — hindi na ito
      // idinadagdag sa isang paulit-ulit na "chat thread" ng magkakasunod
      // na bubble, dahil single-turn lang talaga ang keyword search
      // (walang follow-up memory/context gaya ng AI Chatbot). Itinatago
      // rin ang mga shortcut/Common Questions habang may ipinapakitang
      // resulta, may "Bumalik sa mga karaniwang tanong" na link.
      if (mode !== 'ai') {
        clearImage();
        setKbShortcutsVisible(false);
        renderAnswer(q, resultBox, { showBackLink: true });
        resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }

      const thread = ensureThread(resultBox);
      const userBubble = appendUserBubble(thread, q);
      if (pendingImageDataUrl) {
        const bubbleEl = userBubble.querySelector('.faq-chat-bubble');
        if (bubbleEl) {
          const thumb = document.createElement('img');
          thumb.className = 'faq-chat-image-thumb';
          thumb.src = pendingImageDataUrl;
          thumb.alt = 'Attached screenshot';
          bubbleEl.appendChild(thumb);
        }
      }
      chatHistory.push({ role: 'user', text: q });
      saveChatHistory();

      const handled = await (async () => {
        setSendButtonLoading(true);
        try {
          return await askAIAssistantChat(q, thread);
        } finally {
          setSendButtonLoading(false);
        }
      })();
      if (!handled) {
        appendKbAnswerBubble(q, thread, true);
      }
      saveChatHistory();

      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      thread.scrollTop = thread.scrollHeight;
    },
    newConversation: resetConversation,
    goTo: goTo,
    renderFullList: renderFullList,
    renderAiModeToggle: renderAiModeToggle,
    search: search,
    suggest: suggest,
    onInput: function (value) {
      renderSuggestions(value);
      // BAGO: sa Search (kb) mode, kapag na-clear/binura ang laman ng
      // search box (bagong paghahanap), ibalik ang mga shortcut/Common
      // Questions at alisin ang natitirang sagot — hindi na kailangang
      // manual na i-click pa ang "Bumalik" na link sa ganitong sitwasyon.
      if (effectiveAiMode() !== 'ai' && !(value || '').trim()) {
        const resultBox = document.getElementById('faq-ai-result');
        if (resultBox) resultBox.innerHTML = '';
        setKbShortcutsVisible(true);
      }
    },
    onKeyDown: function (event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); moveSuggestion(1); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); moveSuggestion(-1); return; }
      if (event.key === 'Escape') { hideSuggestions(); return; }
      if (event.key === 'Enter') {
        if (confirmActiveSuggestion()) { event.preventDefault(); return; }
        window.OmniFAQ.ask(event.target.value);
      }
    },
    hideSuggestions: hideSuggestions,
    triggerAttach: triggerAttach,
    onImageSelected: onImageSelected,
    clearImage: clearImage,
    openTicketModal: openTicketModal,
    closeTicketModal: closeTicketModal,
    submitTicket: submitTicket,
    refreshAiCreditPill: refreshAiCreditPill,
    applyFullChatMode: applyFullChatMode
  };

  

  document.addEventListener('DOMContentLoaded', initFullListAndDeepLink);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initFullListAndDeepLink();
  }

  function initFullListAndDeepLink() {
    renderFullList();
    renderAiModeToggle();
    setupSlashShortcut();
    setupFaqComposerKeyboardHandling();
    const ticketBackdrop = document.getElementById('faq-ticket-modal-backdrop');
    if (ticketBackdrop) {
      ticketBackdrop.addEventListener('click', (ev) => {
        if (ev.target === ticketBackdrop) closeTicketModal();
      });
    }
    if (location.hash && location.hash.indexOf('#faq-full-') === 0) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) {
        const parentCategory = target.closest('.faq-category');
        if (parentCategory && 'open' in parentCategory) parentCategory.open = true;
        if ('open' in target) target.open = true;
        setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
      }
    }
  }
})();
