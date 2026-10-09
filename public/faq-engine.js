

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
    'attendance': ['time clock', 'time in', 'time out', 'selfie', 'pasok', 'labas'],
    'pasok': ['time in', 'attendance'],
    'labas': ['time out', 'attendance'],
    'sanga': ['branch', 'branches'],
    'sangay': ['branch', 'branches'],
    'branch': ['sanga', 'sangay', 'store location'],
    'remoteops': ['remote operations', 'monitoring', 'dashboard'],
    'monitor': ['remote operations', 'dashboard', 'overview'],
    'batch': ['lot', 'batch lot', 'expiry'],
    'lot': ['batch', 'batch lot', 'expiry'],
    'expiry': ['batch', 'lot', 'fefo'],
    'bir': ['bir compliance', 'agt', 'z-reading'],
    'buwis': ['bir', 'tax'],
    'tax': ['bir compliance', 'buwis'],
    'invoice': ['bir', 'or', 'official receipt'],
    'transfer': ['stock transfer', 'branch transfer'],
    'held': ['hold', 'hold sale', 'park sale'],
    'hold': ['held', 'park sale', 'suspend transaction'],
  };

  // BAGO: gawing symmetric/transitive ang SYNONYMS sa runtime. Dating
  // directional lang ito (hal. SYNONYMS['benta'] = ['sale', 'checkout',
  // 'bumili', 'magbenta'], pero walang SYNONYMS['sale'] pabalik) — kaya
  // kung ang eksaktong salitang ginamit ng user ay nasa "value" side
  // lang ng mapping (hal. hinanap niya lang ang "sale" mismo), hindi na
  // ito natutugma pabalik sa "benta" (o sa kahit anong ibang salita sa
  // parehong grupo). Dito, binubuo ang buong "equivalence group" ng
  // bawat salita sa pamamagitan ng paglakad sa buong graph ng mga
  // kasingkahulugan (hindi lang direktang kapitbahay, kundi transitive
  // closure din), para alinmang salita sa isang grupo ang gamitin ng
  // user, magkatugma pa rin lahat ng iba pang kasapi ng grupong iyon.
  function buildSymmetricSynonyms(map) {
    const graph = new Map();
    const addEdge = (a, b) => {
      if (!graph.has(a)) graph.set(a, new Set());
      graph.get(a).add(b);
    };
    Object.keys(map).forEach(key => {
      (map[key] || []).forEach(val => {
        addEdge(key, val);
        addEdge(val, key);
      });
    });
    const result = {};
    graph.forEach((_, word) => {
      const seen = new Set([word]);
      const stack = [word];
      while (stack.length) {
        const cur = stack.pop();
        const neighbors = graph.get(cur);
        if (!neighbors) continue;
        neighbors.forEach(n => { if (!seen.has(n)) { seen.add(n); stack.push(n); } });
      }
      seen.delete(word);
      result[word] = Array.from(seen);
    });
    return result;
  }

  const EXPANDED_SYNONYMS = buildSymmetricSynonyms(SYNONYMS);

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
      aiModeAi: 'OmniAI',
      aiModeKb: 'FAQ',
      sendTitle: 'Send',
      stopTitle: 'Stop',
      aiStopped: 'Stopped. You were not charged for this question.',
      searchTitle: 'Search',
      chatPlaceholder: 'Reply to OmniAI...',
      searchPlaceholder: 'Search FAQ...',
      aiModeLockedHint: 'Unlock Omni AI for smarter, more natural answers based on this FAQ',
      aiModeChecking: 'Connecting to Omni AI… it will turn on automatically',
      aiModeOffline: 'Can\'t reach the relay right now — Omni AI will turn on automatically once it\'s reachable. Tap to retry.',
      aiModeOfflineNoNet: 'You seem to be offline — Omni AI will turn on automatically once you\'re back online. Tap to retry.',
      aiRetryToast: 'Checking the connection to Omni AI…',
      aiUpsellLocked: 'Unlock Omni AI for smarter, more natural answers based on this Help Center',
      aiUpsellFree: 'Upgrade your Omni AI plan for image & file attachments, model choice and smarter answers',
      newConversation: 'New conversation',
      feedbackPrompt: 'Was this helpful?',
      feedbackThanksYes: 'Thanks for the feedback!',
      feedbackThanksNo: 'Thanks — try rephrasing your question, or use the knowledge base results below.',
      copyAnswer: 'Copy',
      copied: 'Copied!',
      regenerate: 'Try again',
      voiceInput: 'Voice input',
      voiceListening: 'Listening… tap the microphone again to stop.',
      voiceUnsupported: 'Voice input is not supported by this browser.',
      voicePermissionDenied: 'Microphone access was denied. Allow microphone access in your browser settings and try again.',
      voiceError: 'Voice input could not start. Please try again.',
      aiThinking: 'Omni AI is thinking...',
      aiGeneratedBadge: 'Omni AI answer — based on the OmniPOS FAQ Knowledge Base',
      aiFallbackNotice: 'Omni AI is unavailable right now — showing knowledge base search results instead.',
      aiProviderDown: 'Omni AI has reached its daily usage limit on the AI provider, so it cannot answer right now. You were not charged any credits. Showing knowledge base results instead — please try the AI again later.',
      aiProviderBusy: 'The AI provider is temporarily unavailable or busy, so Omni AI could not answer this time. You were not charged any credits. Showing knowledge base results instead — please try again in a moment.',
      showKbInstead: 'Show knowledge base results instead',
      followUpsLabel: 'You might also ask:',
      retryIn: 'You can ask again in',
      emptyTitle: 'OmniPOS AI Support Agent',
      emptyBody: 'Ask a question, attach a screenshot, or run a quick diagnostic — I can help troubleshoot, explain errors, and guide you around the system.',
      quickActions: 'Quick actions',
      quickDiagnostics: 'Run diagnostics',
      quickExplainError: 'Explain last error',
      quickTicket: 'Create support ticket',
      quickInsights: 'Omni AI insights (Admin)',
      quickTickets: 'Support tickets (Admin)',
      tkTitle: 'Support Tickets', tkNone: 'No support tickets yet.', tkError: 'Could not load support tickets.', tkSaveError: 'Could not update the ticket status.',
      tkStOpen: 'Open', tkStProg: 'In progress', tkStResolved: 'Resolved', tkStClosed: 'Closed',
      tkSentToDev: 'Sent to developer', tkQueued: 'Waiting to be sent to the developer (will retry automatically)', tkNoRelay: 'RELAY is not configured on this server, so tickets stay local', tkSyncFailed: 'Could not be sent to the developer',
      tkDevStatus: 'Developer status', tkDevReply: 'Developer reply', tkYourStatus: 'Store status', tkMore: 'Showing the newest 50 tickets.',
      tkDelete: 'Delete', tkDeleteTitle: 'Delete this ticket?', tkDeleteText: 'This removes the ticket from this device permanently.', tkDeleteUnsent: 'It has NOT been sent to the developer yet, so it will never be sent.', tkDeleteSent: 'The developer keeps their own copy of tickets already sent.', tkDeleteConfirm: 'Yes, delete', tkDeleteCancel: 'Cancel', tkDeleteError: 'Could not delete the ticket.',
      tkDeskClosed: 'Support is currently unavailable. Saved on this device; it will be sent automatically when support reopens',
      tkDeskBanner: 'The support team is currently unavailable. Tickets you create are saved here and sent automatically once support reopens.',
      ticketSuccessQueued: 'Ticket saved! The support team is currently unavailable, so it will be sent automatically when they are back.',
      quickCredits: 'Show AI credits',
      insTitle: 'Omni AI Insights', insTotal: 'Total questions', insAnswered: 'Answered', insHelpful: 'Helpful rate',
      insAvg: 'Avg. response', insTop: 'Most asked', insDown: 'Most downvoted (👎)', insFailed: 'Recent failed / unanswered',
      insNone: 'None yet', insError: 'Could not load Omni AI insights.', insClose: 'Close', insRated: 'rated', insLoading: 'Loading insights...',
      insReset: 'Reset', insResetTitle: 'Reset Omni AI Insights?', insResetText: 'This permanently clears all question history and ratings.', insResetConfirm: 'Yes, reset', insResetDone: 'Insights were reset.', insResetError: 'Could not reset the insights.',
      diagnosticsQuestion: 'Please run a quick diagnostic check and tell me if anything looks unusual.',
      explainErrorQuestion: 'Can you explain the recent error(s) captured in my browser and what I should do about it?',
      noErrorsCaptured: 'No recent JavaScript errors have been captured in this browser session — that\'s a good sign!',
      creditsLabel: 'AI credits',
      creditsExhausted: 'Monthly AI credits used up for this store. Resets next month.',
      attachRemoved: 'Screenshot removed.',
      goTo: 'Go to',
      unlockTo: 'Unlock',
      lockedNoteSubscription: 'Reminder: "{name}" is not yet activated in this store. It needs a subscription first — tap the lock button to see the plans and price.',
      lockedNoteOneTime: 'Reminder: "{name}" is not yet activated in this store. It needs a one-time purchase first — tap the lock button to see the price.',
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
      fileTooLarge: 'That file is too large. Please attach a smaller document (max ~8MB).',
      fileUnsupported: 'Unsupported file type. Supported: images, PDF, DOCX, TXT, CSV.',
      backToCommon: 'Back to common questions',
      newSearch: 'New search',
      scrollToLatest: 'Scroll to latest'
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
      aiModeAi: 'OmniAI',
      aiModeKb: 'FAQ',
      sendTitle: 'Ipadala',
      stopTitle: 'Itigil',
      aiStopped: 'Itinigil. Hindi ka nasingil sa tanong na ito.',
      searchTitle: 'Maghanap',
      chatPlaceholder: 'Reply to OmniAI...',
      searchPlaceholder: 'Maghanap sa FAQ...',
      aiModeLockedHint: 'I-unlock ang Omni AI para sa mas matalino at natural na sagot batay sa FAQ na ito',
      aiModeChecking: 'Kumokonekta sa Omni AI… kusa itong mag-o-on',
      aiModeOffline: 'Hindi maabot ang relay ngayon — kusang mag-o-on ang Omni AI pagka-abot nito. I-tap para subukan ulit.',
      aiModeOfflineNoNet: 'Mukhang offline ka — kusang mag-o-on ang Omni AI pagbalik ng internet. I-tap para subukan ulit.',
      aiRetryToast: 'Chine-check ang koneksyon sa Omni AI…',
      aiUpsellLocked: 'I-unlock ang Omni AI para sa mas matalino at natural na sagot batay sa Help Center na ito',
      aiUpsellFree: 'I-upgrade ang Omni AI plan para sa pag-attach ng larawan/file, pagpili ng model at mas matatalinong sagot',
      newConversation: 'Bagong usapan',
      feedbackPrompt: 'Nakatulong ba ito?',
      feedbackThanksYes: 'Salamat sa feedback!',
      feedbackThanksNo: 'Salamat — subukan i-ibang salita ang tanong, o gamitin ang resulta ng knowledge base sa ibaba.',
      copyAnswer: 'Kopyahin',
      copied: 'Nakopya!',
      regenerate: 'Subukan ulit',
      aiThinking: 'Iniisip ng Omni AI ang sagot...',
      aiGeneratedBadge: 'Sagot ng Omni AI — batay sa OmniPOS FAQ Knowledge Base',
      aiFallbackNotice: 'Hindi available ang Omni AI sa ngayon — ipinapakita na lang ang resulta ng knowledge base search.',
      aiProviderDown: 'Naabot na ng Omni AI ang daily limit ng AI provider kaya hindi ito makasagot ngayon. Hindi ka nasingil ng credits. Ipinapakita muna ang resulta ng knowledge base — subukan ulit ang AI mamaya.',
      aiProviderBusy: 'Pansamantalang hindi available o abala ang AI provider kaya hindi nakasagot ang Omni AI ngayon. Hindi ka nasingil ng credits. Ipinapakita muna ang resulta ng knowledge base — subukan ulit sa ilang sandali.',
      showKbInstead: 'Ipakita na lang ang resulta ng knowledge base',
      followUpsLabel: 'Baka gusto mo ring itanong:',
      retryIn: 'Puwede ka nang magtanong ulit pagkalipas ng',
      emptyTitle: 'OmniPOS AI Support Agent',
      emptyBody: 'Magtanong, mag-attach ng screenshot, o mag-run ng quick diagnostic — matutulungan kitang mag-troubleshoot, ipaliwanag ang error, at gabayan sa system.',
      quickActions: 'Mga quick action',
      quickDiagnostics: 'Mag-run ng diagnostics',
      quickExplainError: 'Ipaliwanag ang huling error',
      quickTicket: 'Gumawa ng support ticket',
      quickInsights: 'Omni AI insights (Admin)',
      quickTickets: 'Mga support ticket (Admin)',
      tkTitle: 'Mga Support Ticket', tkNone: 'Wala pang support ticket.', tkError: 'Hindi ma-load ang mga support ticket.', tkSaveError: 'Hindi ma-update ang status ng ticket.',
      tkStOpen: 'Bukas', tkStProg: 'Ginagawa', tkStResolved: 'Naayos', tkStClosed: 'Sarado',
      tkSentToDev: 'Naipadala sa developer', tkQueued: 'Naghihintay maipadala sa developer (awtomatikong susubukan ulit)', tkNoRelay: 'Walang naka-configure na RELAY sa server na ito, kaya lokal lang ang mga ticket', tkSyncFailed: 'Hindi naipadala sa developer',
      tkDevStatus: 'Status ng developer', tkDevReply: 'Sagot ng developer', tkYourStatus: 'Status sa store', tkMore: 'Ipinapakita ang pinakabagong 50 ticket.',
      tkDelete: 'Burahin', tkDeleteTitle: 'Burahin ang ticket na ito?', tkDeleteText: 'Permanente itong mabubura sa device na ito.', tkDeleteUnsent: 'HINDI pa ito naipapadala sa developer, kaya hindi na ito maipapadala kapag binura.', tkDeleteSent: 'May sariling kopya ang developer ng mga ticket na naipadala na.', tkDeleteConfirm: 'Oo, burahin', tkDeleteCancel: 'Kanselahin', tkDeleteError: 'Hindi mabura ang ticket.',
      tkDeskClosed: 'Walang available na support ngayon. Naka-save sa device na ito; awtomatikong ipapadala kapag bumalik na ang support',
      tkDeskBanner: 'Walang available na support team ngayon. Ang mga ticket na gagawin mo ay naka-save dito at awtomatikong ipapadala kapag bumalik na ang support.',
      ticketSuccessQueued: 'Naka-save ang ticket! Walang available na support team ngayon, kaya awtomatiko itong ipapadala kapag bumalik na sila.',
      quickCredits: 'Ipakita ang AI credits',
      insTitle: 'Omni AI Insights', insTotal: 'Kabuuang tanong', insAnswered: 'Nasagot', insHelpful: 'Helpful rate',
      insAvg: 'Avg. bilis ng sagot', insTop: 'Pinakamadalas itanong', insDown: 'Pinaka-nabigyan ng 👎', insFailed: 'Kamakailang nabigo / hindi nasagot',
      insNone: 'Wala pa', insError: 'Hindi ma-load ang Omni AI insights.', insClose: 'Isara', insRated: 'na-rate', insLoading: 'Nilo-load ang insights...',
      insReset: 'I-reset', insResetTitle: 'I-reset ang Omni AI Insights?', insResetText: 'Permanenteng buburahin ang lahat ng tanong at rating.', insResetConfirm: 'Oo, i-reset', insResetDone: 'Na-reset na ang insights.', insResetError: 'Hindi ma-reset ang insights.',
      diagnosticsQuestion: 'Pakisuri ang quick diagnostic at sabihin kung may kakaiba.',
      explainErrorQuestion: 'Pwede mo bang ipaliwanag ang kamakailang error sa browser ko at ano ang dapat kong gawin?',
      noErrorsCaptured: 'Walang na-capture na JavaScript error sa browser session na ito — magandang tanda iyan!',
      creditsLabel: 'AI credits',
      creditsExhausted: 'Naubos na ang buwanang AI credits ng store na ito. Mare-reset sa susunod na buwan.',
      attachRemoved: 'Naalis ang screenshot.',
      goTo: 'Pumunta sa',
      unlockTo: 'I-unlock ang',
      lockedNoteSubscription: 'Paalala: ang "{name}" ay hindi pa naka-activate sa store na ito. Kailangan muna ng subscription — pindutin ang lock button para makita ang plans at presyo.',
      lockedNoteOneTime: 'Paalala: ang "{name}" ay hindi pa naka-activate sa store na ito. Kailangan muna itong bilhin (one-time) — pindutin ang lock button para makita ang presyo.',
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
      fileTooLarge: 'Masyadong malaki ang file. Mag-attach ng mas maliit na dokumento (max ~8MB).',
      fileUnsupported: 'Hindi suportadong file type. Suportado: larawan, PDF, DOCX, TXT, CSV.',
      backToCommon: 'Bumalik sa mga karaniwang tanong',
      newSearch: 'Bagong paghahanap',
      scrollToLatest: 'Pumunta sa pinakabago'
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
      if (EXPANDED_SYNONYMS[t]) EXPANDED_SYNONYMS[t].forEach(s => expanded.add(s));
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
    // BAGO: magkatabing letra na nagkapalit (hal. "viod" vs "void") ay
    // 1 pagkakamali lang sa pagtype, pero 2 edits sa Levenshtein.
    if (tokenA.length === tokenB.length) {
      for (let i = 0; i < tokenA.length - 1; i++) {
        if (tokenA[i] !== tokenB[i]) {
          if (tokenA[i] === tokenB[i + 1] && tokenA[i + 1] === tokenB[i] &&
              tokenA.slice(i + 2) === tokenB.slice(i + 2)) return true;
          break;
        }
      }
    }
    const tolerance = Math.min(fuzzyTolerance(tokenA.length), fuzzyTolerance(tokenB.length));
    return levenshtein(tokenA, tokenB) <= tolerance;
  }

  // BAGO: word-aware matching. Dati, plain substring ang gamit
  // (kaya ang "void" ay tumutugma rin sa "avoid" at hindi napapansin ang
  // dami ng beses na lumabas ang salita). Ngayon, ang eksaktong salita o
  // ang salitang nagsisimula sa query (hal. "void" -> "voided", "voiding",
  // "void-able") ang pinakamataas ang score; ang pagkakatugma sa gitna ng
  // salita (hal. Tagalog na may unlapi: "magvoid") ay tinatanggap lang sa
  // keywords/tanong at mas mababa ang score.
  function wordsOf(normText) {
    return normText ? normText.split(' ') : [];
  }
  function hasWordMatch(words, tok) {
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w === tok) return true;
      if (tok.length >= 3 && w.startsWith(tok)) return true;
      if (w.length >= 4 && tok.length > w.length && tok.startsWith(w)) return true;
    }
    return false;
  }
  function countWordMatches(words, tok) {
    let n = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w === tok || (tok.length >= 3 && w.startsWith(tok)) || (w.length >= 4 && tok.length > w.length && tok.startsWith(w))) n++;
    }
    return n;
  }

  // baseTokens = ang mismong tinype ng user (walang synonyms). Ang entry na
  // may mismong salitang tinype ay laging nauuna sa mga synonym-only na tugma.
  function scoreEntry(entry, queryTokens, baseTokens) {
    const kwText = normalize(entry.keywords.join(' '));
    const qText = normalize(entry.question);
    const aText = normalize(stripHtml(entry.answer));
    const kwWords = wordsOf(kwText);
    const qWords = wordsOf(qText);
    const aWords = wordsOf(aText);
    const literal = new Set(baseTokens || []);

    const kwTokens = tokenize(entry.keywords.join(' '));
    const qTokens = tokenize(entry.question);

    let score = 0;
    queryTokens.forEach(tok => {
      let exactHit = false;
      const isLiteral = literal.has(tok);

      if (hasWordMatch(kwWords, tok)) { score += 3; exactHit = true; if (isLiteral) score += 2; }
      else if (tok.length >= 4 && kwText.includes(tok)) { score += 1.5; exactHit = true; }

      if (hasWordMatch(qWords, tok)) { score += 2; exactHit = true; if (isLiteral) score += 2; }
      else if (tok.length >= 4 && qText.includes(tok)) { score += 1; exactHit = true; }

      const aCount = countWordMatches(aWords, tok);
      if (aCount > 0) {
        // 0.5 sa unang paglabas + maliit na dagdag sa bawat karagdagang
        // paglabas (hanggang 5) para ang mas "tungkol" sa salita ay mas mataas.
        score += 0.5 + Math.min(aCount - 1, 4) * 0.25;
        if (isLiteral) score += 1;
        exactHit = true;
      }

      // typo tolerance (hindi nagbago): pantulong lang kapag walang exact hit.
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
    // BAGO: simpleng stemming — "voided"/"voiding"/"voids" -> "void",
    // para lumabas pa rin ang lahat ng may salitang "void".
    const baseTokens = [];
    tokenize(query).forEach(t => {
      baseTokens.push(t);
      if (t.length >= 5) {
        const m = t.match(/^(.{3,}?)(ing|ed|es|s)$/);
        if (m && !baseTokens.includes(m[1])) baseTokens.push(m[1]);
      }
    });
    const tokens = expandTokens(baseTokens);
    if (tokens.length === 0) return [];

    const scored = kb.map(entry => ({ entry, score: scoreEntry(entry, tokens, baseTokens) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit || 5);
  }

  

  function suggest(query, limit) {
    const q = (query || '').trim();
    if (q.length < 2) return [];

    const results = search(q, 60);
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
  function ensureKbRelatedStyles() {
    if (document.getElementById('faq-kb-related-style')) return;
    const st = document.createElement('style');
    st.id = 'faq-kb-related-style';
    st.textContent = `
      .faq-related-list { list-style: none; margin: 8px 0 0; padding: 0; }
      .faq-related-list li { padding: 7px 0; border-bottom: 1px solid rgba(148,163,184,0.25); line-height: 1.35; }
      .faq-related-list li:last-child { border-bottom: 0; }
      .faq-related-count { opacity: .7; font-weight: 500; }
      .faq-related-cat { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; font-size: .72em; background: rgba(148,163,184,0.2); opacity: .85; white-space: nowrap; vertical-align: middle; }
      .faq-related-list mark { background: rgba(250,204,21,0.45); color: inherit; border-radius: 3px; padding: 0 1px; }
    `;
    document.head.appendChild(st);
  }

  function buildKbAnswerInnerHtml(query) {
    // BAGO: dati, 5 lang ang kinukuha (1 sagot + 3 related). Ngayon, lahat
    // ng entry na may kaugnayan sa hinanap na salita ay ipinapakita.
    const results = search(query, 100);
    const s = STRINGS();

    if (results.length === 0) {
      // BAGO: itala sa lokal na analytics log (see logUnansweredQuery sa
      // itaas) tuwing walang eksakto/malapit na nahanap na sagot ang
      // keyword search — kahit saang mode ito nangyari (Search/kb mode
      // mismo, o AI Chatbot mode na na-fallback sa keyword search).
      logUnansweredQuery(query, 'no_kb_result');
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
    const related = results.slice(1).map(r => r.entry);
    const hlTokens = tokenize(query);
    const lang = currentLang();
    ensureKbRelatedStyles();
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
          <strong>${s.relatedQuestions} <span class="faq-related-count">(${related.length})</span></strong>
          <ul class="faq-related-list">
            ${related.map(r => `<li><a href="#${slugId(r.id)}" class="faq-link" data-faq-id="${escapeHtml(r.id)}" data-faq-q="${escapeHtml(r.question)}">${highlight(r.question, hlTokens)}</a> <span class="faq-related-cat">${escapeHtml(r.category)}</span></li>`).join('')}
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
    const matches = suggest(query, 12);
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
      // AYOS: sa FAQ (Search) mode, hindi na ginagamit ang scrollIntoView
      // (nag-i-scroll ito ng mga parent at napupunta ang header ng resulta
      // sa ilalim ng top toggles). Ang AI mode ay hindi ginagalaw.
      if (effectiveAiMode() !== 'ai') keepFaqResultBelowToggles(resultBox);
      else resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const targetId = slugId(id);
    const target = document.getElementById(targetId);
    if (target) {
      const parentCategory = target.closest('.faq-category');
      if (parentCategory && 'open' in parentCategory) parentCategory.open = true;
      if ('open' in target) target.open = true;
      setTimeout(() => {
        // AYOS: sa FAQ (Search) mode, nakatago ang buong listahan (#faq-kb-shortcuts)
        // habang may resulta, kaya ang scrollIntoView dito ay walang makikitang
        // target at nag-i-scroll lang ng page/parent (dito nagmumula ang pagtalon
        // ng resulta sa ilalim ng toggles). Sa AI mode, hindi ginagalaw.
        if (effectiveAiMode() === 'ai') {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          keepFaqResultBelowToggles(resultBox);
        }
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
        <details class="faq-category" id="${slugCat(cat)}">
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
  // ang user (Omni AI vs Keyword Search — see renderAiModeToggle)
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

  // ---- FREE tier (Omni AI Free plan) ---------------------------------------
  // Walang Omni AI subscription = FREE plan (text lang, naka-Cloudflare sa RELAY). Ang RELAY ang nagsasabi kung naka-ON ang Free
  // (/ai-assistant/free-status). Ang naka-subscribe ay Base/Plus/Pro (Google) at mayroong attach/model picker/ticket.
  //
  // BAGONG AYOS: dati 'false' ang simula at 'false' din kapag pumalya ang RELAY, kaya laging LOCK icon ang lumalabas hangga't wala pang
  // sagot — kahit offline o hindi lang maabot ang RELAY. Ngayon may 4 na estado ang OmniAI toggle (aiFreeToggleState):
  //   'ready'    — may magagamit na Omni AI (naka-subscribe, o naka-ON ang Free ayon sa RELAY / huling kilalang sagot)
  //   'locked'   — LANG kapag ang RELAY mismo ang nagsabi (sa session na ito) na naka-OFF ang Free at walang subscription
  //   'checking' — kasalukuyang tinatanong ang RELAY (walang lock)
  //   'offline'  — hindi maabot ang RELAY / walang internet: walang lock, kusang nagre-retry hanggang sumagot
  // Pagbukas ng Help, agad na tinatanong ang RELAY (refresh=1) at kusang nag-a-activate ang Free kapag naka-ON.
  const AI_FREE_LAST_KEY = 'omnipos_faq_ai_free_last';
  const AI_FREE_RETRY_DELAYS_MS = [3000, 6000, 12000, 20000, 30000, 60000];
  let aiFreeEnabled = false;      // huling kilalang sagot ng RELAY (galing sa server o sa localStorage)
  let aiFreeKnown = false;        // may nakuha nang totoong sagot ang RELAY kahit minsan
  let aiFreeConfirmed = false;    // true = sumagot ang RELAY nang FRESH sa session na ito
  let aiFreeReason = null;        // 'offline' | 'relay_unreachable' | 'relay_error' | 'no_key' | null
  let aiFreeLoadedAt = 0;
  let aiFreeLoading = false;
  let aiFreeRetryTimer = null;
  let aiFreeRetryCount = 0;
  let aiFreeWantsAi = false;      // pinindot ng user ang OmniAI habang hindi pa ready: ilipat siya sa AI pagka-ready
  let aiFreeRenderedSig = '';     // estado na huling iginuhit ng toggle (para malamang kung kailangan ulit i-render)

  (function restoreAiFreeLastKnown() {
    try {
      const raw = JSON.parse(localStorage.getItem(AI_FREE_LAST_KEY) || 'null');
      if (raw && typeof raw.enabled === 'boolean') { aiFreeEnabled = raw.enabled; aiFreeKnown = true; }
    } catch (e) { /* walang magagamit na huling sagot */ }
  })();

  function persistAiFreeLastKnown() {
    try { localStorage.setItem(AI_FREE_LAST_KEY, JSON.stringify({ enabled: aiFreeEnabled, at: Date.now() })); } catch (e) {}
  }

  function aiFreeSignature() {
    return aiFreeToggleState() + '|' + aiFreeReason;
  }

  function aiFreeToggleState() {
    if (aiAssistantUnlocked()) return 'ready';
    if (aiFreeKnown && aiFreeEnabled) return 'ready';
    if (aiFreeKnown && aiFreeConfirmed) return 'locked'; // sumagot ang RELAY ngayon: naka-OFF ang Free
    if (aiFreeLoading || !aiFreeReason) return 'checking';
    return 'offline';
  }

  function isFaqViewVisible() {
    const view = document.getElementById('view-faq');
    return !!view && view.getClientRects().length > 0;
  }

  function clearAiFreeRetry() {
    if (aiFreeRetryTimer) { clearTimeout(aiFreeRetryTimer); aiFreeRetryTimer = null; }
  }

  function scheduleAiFreeRetry() {
    clearAiFreeRetry();
    if (aiAssistantUnlocked() || aiFreeConfirmed) return;
    const delay = AI_FREE_RETRY_DELAYS_MS[Math.min(aiFreeRetryCount, AI_FREE_RETRY_DELAYS_MS.length - 1)];
    aiFreeRetryCount++;
    aiFreeRetryTimer = setTimeout(() => {
      aiFreeRetryTimer = null;
      if (!isFaqViewVisible()) return; // titigil habang wala sa Help; ipagpapatuloy pagbukas ulit
      loadAiFreeStatus(true);
    }, delay);
  }

  function applyAiFreeResult(data) {
    if (data && data.success) {
      const fresh = !!data.known && (!data.reason || data.reason === 'no_key');
      if (data.known) { aiFreeKnown = true; aiFreeEnabled = !!data.enabled; }
      aiFreeConfirmed = fresh;
      aiFreeReason = fresh ? null : (data.reason || 'relay_unreachable');
      if (fresh) persistAiFreeLastKnown();
    } else {
      aiFreeConfirmed = false;
      aiFreeReason = 'relay_unreachable';
    }
    if (aiFreeConfirmed) { aiFreeRetryCount = 0; clearAiFreeRetry(); } else { scheduleAiFreeRetry(); }
    let intentApplied = false;
    if (aiFreeWantsAi) {
      const st = aiFreeToggleState();
      if (st === 'ready') { storeAiModePref('ai'); aiFreeWantsAi = false; intentApplied = true; }
      else if (st === 'locked') { aiFreeWantsAi = false; }
    }
    // Ihambing sa HULING IGINUHIT (hindi sa estado bago ang sagot) — dahil ang spinner ay iginuguhit habang naghihintay, kailangan itong palitan pagdating ng sagot.
    if (aiFreeRenderedSig !== aiFreeSignature() || intentApplied) { try { renderAiModeToggle(); } catch (e) {} }
  }

  // force = laktawan ang cache at tanungin agad ang RELAY (refresh=1; hanggang ~30s ang hintay para sa cold start ng hosting).
  function loadAiFreeStatus(force) {
    if (aiAssistantUnlocked()) return;
    if (aiFreeLoading) return;
    const fresh = aiFreeConfirmed && (Date.now() - aiFreeLoadedAt < 60000);
    if (!force && (fresh || Date.now() - aiFreeLoadedAt < 5000)) return;
    aiFreeLoading = true;
    // Kapag nasa 'offline' at nagre-retry, ipakita agad ang "checking" (spinner) — at dapat nakatakda na ang aiFreeLoading bago mag-render.
    if (aiFreeRenderedSig !== aiFreeSignature()) { try { renderAiModeToggle(); } catch (e) {} }
    (async () => {
      let result = null;
      try {
        const res = await authFetch(`${API_URL}/ai-assistant/free-status${force ? '?refresh=1' : ''}`, { timeoutMs: force ? 30000 : 12000 });
        const data = res && res.ok ? await res.json().catch(() => null) : null;
        if (data && data.success) result = data;
      } catch (e) { result = null; }
      aiFreeLoadedAt = Date.now();
      aiFreeLoading = false;
      applyAiFreeResult(result);
    })();
  }

  function onFaqViewShown() {
    if (aiAssistantUnlocked()) return;
    aiFreeRetryCount = 0;
    clearAiFreeRetry();
    loadAiFreeStatus(true);
  }

  // Pagbukas ng Help (kahit saang paraan binuksan), pagbalik ng internet, o pagbalik sa app: agad na i-check ang RELAY.
  function setupAiFreeAutoCheck() {
    const view = document.getElementById('view-faq');
    if (!view || view.dataset.aiFreeWatch === '1') return;
    view.dataset.aiFreeWatch = '1';
    let wasVisible = isFaqViewVisible();
    const onChange = () => {
      const nowVisible = isFaqViewVisible();
      if (nowVisible && !wasVisible) onFaqViewShown();
      wasVisible = nowVisible;
    };
    if (typeof MutationObserver === 'function') {
      const mo = new MutationObserver(onChange);
      mo.observe(view, { attributes: true, attributeFilter: ['style', 'class'] });
      const mainView = document.getElementById('main-view');
      if (mainView) mo.observe(mainView, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    window.addEventListener('online', () => {
      if (aiAssistantUnlocked() || !isFaqViewVisible()) return;
      aiFreeRetryCount = 0;
      loadAiFreeStatus(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || aiAssistantUnlocked() || aiFreeConfirmed || !isFaqViewVisible()) return;
      loadAiFreeStatus(true);
    });
    if (wasVisible) onFaqViewShown();
  }

  function showAiFreeHint(msg) {
    try {
      if (window.Swal && typeof window.Swal.fire === 'function') {
        window.Swal.fire({ toast: true, position: 'top', icon: 'info', title: msg, showConfirmButton: false, timer: 3200, timerProgressBar: true });
      }
    } catch (e) { /* walang toast, walang problema */ }
  }

  // May magagamit na AI chat? (naka-subscribe, o naka-ON ang Free sa RELAY)
  function aiChatEnabled() {
    if (aiAssistantUnlocked()) return true;
    loadAiFreeStatus(false);
    return aiFreeToggleState() === 'ready';
  }

  // Ang upsell sa ilalim ng composer: 'locked' = "I-unlock ang Omni AI", 'ready' sa Free = "Mag-upgrade" (bubuksan ang plans),
  // at nakatago habang 'checking'/'offline' (para hindi magmukhang naka-lock) o kapag naka-subscribe na.
  function syncAiUpsell() {
    const box = document.getElementById('faq-ai-upsell');
    if (!box) return;
    if (aiAssistantUnlocked()) { box.style.display = 'none'; return; }
    const st = aiFreeToggleState();
    const textEl = document.getElementById('faq-ai-upsell-text');
    const link = box.querySelector('a');
    const s = STRINGS();
    if (st === 'locked') {
      if (textEl) textEl.textContent = s.aiUpsellLocked;
      if (link) link.onclick = (ev) => { ev.preventDefault(); if (typeof guardPremiumFeature === 'function') guardPremiumFeature('ai_assistant'); };
      box.style.display = 'block';
    } else if (st === 'ready') {
      if (textEl) textEl.textContent = s.aiUpsellFree;
      if (link) link.onclick = (ev) => { ev.preventDefault(); openAiPlansModal(); };
      box.style.display = 'block';
    } else {
      box.style.display = 'none';
    }
  }

  const AI_MODE_KEY = 'omnipos_faq_ai_mode';

  // BUGFIX: dati, kapag nag-search ka sa FAQ (kb mode) tapos lumipat ka sa
  // OmniAI, binubura ang resulta + search text, kaya blangko na pagbalik.
  // Ngayon, itinatabi (stash) ang FAQ search (mismong DOM nodes, para
  // buo pa rin ang mga event listener) at ang laman ng input habang nasa
  // OmniAI, at ibinabalik pagbalik sa FAQ. Ganoon din ang draft na
  // tina-type sa OmniAI composer — hindi na nahahalo sa FAQ search.
  const kbModeStash = { nodes: null, input: '', lang: '' };
  let aiModeDraftStash = '';

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
    if (!aiChatEnabled()) return 'kb';
    return getStoredAiModePref() === 'kb' ? 'kb' : 'ai';
  }

  function renderAiModeToggle() {
    const box = document.getElementById('faq-ai-mode-toggle');
    if (!box) return;
    applySendButtonIcon();
    const s = STRINGS();
    const unlocked = aiChatEnabled();
    const mode = effectiveAiMode();
    aiFreeRenderedSig = aiFreeSignature();

    if (!unlocked) {
      // Parehong ayos ng ready na toggle (OmniAI sa kaliwa, FAQ sa kanan; FAQ ang aktibo) para laging nakikita ang aktibong label.
      // Lock icon LANG kapag ang RELAY mismo ang nagsabing naka-OFF ang Free; habang naghihintay/offline ay spinner/retry icon.
      const tState = aiFreeToggleState();
      const noNet = aiFreeReason === 'offline';
      const hint = tState === 'locked' ? s.aiModeLockedHint : (tState === 'offline' ? (noNet ? s.aiModeOfflineNoNet : s.aiModeOffline) : s.aiModeChecking);
      const icon = tState === 'locked' ? 'fa-lock' : (tState === 'offline' ? 'fa-arrows-rotate' : 'fa-circle-notch fa-spin');
      box.innerHTML = `
        <div class="faq-mode-toggle faq-mode-toggle-locked faq-mode-toggle-${tState}" data-active="kb" data-ai-state="${tState}">
          <div class="faq-mode-slider"></div>
          <button type="button" class="faq-mode-option faq-mode-locked-option faq-mode-pending-option" data-ai-pending="${tState}"
                  title="${escapeHtml(hint)}" aria-label="${escapeHtml(s.aiModeAi + ' — ' + hint)}">
            <i class="fa-solid ${icon}"></i> ${s.aiModeAi}
          </button>
          <span class="faq-mode-option active"><i class="fa-solid fa-circle-question"></i> ${s.aiModeKb}</span>
        </div>`;
      box.querySelectorAll('[data-ai-pending]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (tState === 'locked') {
            if (typeof guardPremiumFeature === 'function') guardPremiumFeature('ai_assistant');
            return;
          }
          aiFreeWantsAi = true;
          aiFreeRetryCount = 0;
          showAiFreeHint(s.aiRetryToast);
          loadAiFreeStatus(true);
        });
      });
      const lockedPill = document.getElementById('ai-assistant-credit-pill');
      if (lockedPill) lockedPill.style.display = 'none';
      if (typeof window.syncAiCreditExpiryWrapper === 'function') window.syncAiCreditExpiryWrapper();
      syncAiUpsell();
      return;
    }

    box.innerHTML = `
      <div class="faq-mode-toggle" data-active="${mode}">
        <div class="faq-mode-slider"></div>
        <button type="button" class="faq-mode-option ${mode === 'ai' ? 'active' : ''}" data-mode="ai">
          ${omniLogoIcon('1.05em', false)} ${s.aiModeAi}
        </button>
        <button type="button" class="faq-mode-option ${mode === 'kb' ? 'active' : ''}" data-mode="kb">
          <i class="fa-solid fa-circle-question"></i> ${s.aiModeKb}
        </button>
      </div>`;

    box.querySelectorAll('.faq-mode-option[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nextMode = btn.dataset.mode === 'kb' ? 'kb' : 'ai';
        const currentMode = effectiveAiMode();
        if (nextMode === currentMode) return;

        storeAiModePref(nextMode);

        // FIX: clear mode-specific UI when switching modes.
        // Otherwise an AI chat thread could remain visible in Search mode
        // (or a previous keyword result could remain behind the AI chat).
        const resultBox = document.getElementById('faq-ai-result');
        const input = document.getElementById('faq-ai-input');
        const suggestions = document.getElementById('faq-ai-suggestions');
        if (suggestions) suggestions.style.display = 'none';
        activeSuggestIndex = -1;

        if (currentMode === 'kb') {
          // Aalis sa FAQ search papuntang OmniAI: itabi ang FAQ search.
          const frag = document.createDocumentFragment();
          if (resultBox) { while (resultBox.firstChild) frag.appendChild(resultBox.firstChild); }
          kbModeStash.nodes = frag.childNodes.length ? frag : null;
          kbModeStash.input = input ? input.value : '';
          kbModeStash.lang = currentLang();
          if (input) input.value = aiModeDraftStash;
          aiModeDraftStash = '';
        } else {
          // Aalis sa OmniAI papuntang FAQ search: itabi ang AI draft,
          // at ibalik ang dating FAQ search (kung meron).
          aiModeDraftStash = input ? input.value : '';
          if (resultBox) resultBox.innerHTML = '';
          // Kapag napalitan ang wika habang nasa OmniAI, luma na ang naka-save
          // na resulta (nasa dating wika) — huwag ibalik.
          const sameLang = kbModeStash.lang === currentLang();
          if (input) input.value = sameLang ? (kbModeStash.input || '') : '';
          if (sameLang && kbModeStash.nodes && resultBox) resultBox.appendChild(kbModeStash.nodes);
          kbModeStash.nodes = null;
          kbModeStash.input = '';
          kbModeStash.lang = '';
        }

        renderAiModeToggle();
        if (nextMode === 'kb') keepFaqResultBelowToggles(document.getElementById('faq-ai-result'));
      });
    });

    applyFullChatMode();
    renderQuickActions();
    refreshTicketButtonVisibility();
    refreshAiCreditPill();
    syncAiUpsell();
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
    applySendButtonIcon();
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
        <span style="color:var(--primary-blue,#2563eb);opacity:0.85;display:inline-flex;">${omniLogoIcon('2.4rem', false)}</span>
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
          <div class="faq-ai-badge">${omniLogoIcon('1.1em', false)} ${s.aiGeneratedBadge}</div>
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
  // Sinusukat ang tunay na taas ng bottom nav (kasama ang safe-area) at
  // itinatakda bilang --faq-bottom-nav-h sa #view-faq, para eksaktong 3px
  // lang ang pagitan ng composer at ng bottom nav sa mobile chat.
  function syncFaqBottomNavHeight() {
    const view = document.getElementById('view-faq');
    if (!view) return;
    const nav = document.getElementById('app-bottom-nav');
    const h = nav ? nav.offsetHeight : 0;
    if (h > 0) view.style.setProperty('--faq-bottom-nav-h', `${h}px`);
    else view.style.removeProperty('--faq-bottom-nav-h');
  }

  // ---- mobile: i-lock ang mismong page habang nasa Help ---------------
  // Sa mobile (<= 768px), fixed ang buong Help page: hindi na nag-i-scroll
  // ang dokumento/body, at ang loob lang ng chatbox (thread / search
  // results) ang nag-i-scroll — kaya laging pareho ang 3px gap sa ibabaw
  // ng bottom nav. Awtomatikong inaalis ang lock kapag lumipat ng view,
  // nag-logout (main-view nakatago), o lumaki ang screen (> 768px).
  function syncFaqPageLock() {
    const view = document.getElementById('view-faq');
    const mainView = document.getElementById('main-view');
    const visible = !!view && view.style.display !== 'none' && view.offsetParent !== null &&
      !!mainView && mainView.style.display !== 'none';
    const lock = visible && window.innerWidth <= 768;
    const wasLocked = document.documentElement.classList.contains('faq-page-lock');
    document.documentElement.classList.toggle('faq-page-lock', lock);
    document.body.classList.toggle('faq-page-lock', lock);
    // Kapag kakapasok lang sa lock, ibalik sa itaas ang page para hindi
    // ma-stuck na naka-scroll pababa (walang paraan nang bumalik kapag lock na).
    if (lock && !wasLocked) window.scrollTo(0, 0);
  }

  let faqPageLockWired = false;
  function wireFaqPageLock() {
    if (faqPageLockWired) return;
    faqPageLockWired = true;
    window.addEventListener('resize', syncFaqPageLock);
    window.addEventListener('orientationchange', syncFaqPageLock);
    if (typeof MutationObserver === 'function') {
      const mo = new MutationObserver(syncFaqPageLock);
      const view = document.getElementById('view-faq');
      const mainView = document.getElementById('main-view');
      if (view) mo.observe(view, { attributes: true, attributeFilter: ['style', 'class'] });
      if (mainView) mo.observe(mainView, { attributes: true, attributeFilter: ['style'] });
    }
    syncFaqPageLock();
  }

  function syncFaqBoxMinHeight() {
    syncFaqPageLock();
    const view = document.getElementById('view-faq');
    const box = document.getElementById('faq-ai-box');
    if (!view || !box) return;
    syncFaqBottomNavHeight();
    if (view.style.display === 'none' || view.classList.contains('faq-fullchat-mode') || window.innerWidth >= 1025) {
      box.style.removeProperty('min-height');
      return;
    }
    if (box.offsetParent === null) return; // hindi pa talaga nakikita
    const top = box.getBoundingClientRect().top;
    // tugma sa reserved bottom offset na ginagamit na ng .faq-composer-dock
    // mismo (see @media max-width:1024px sa itaas), plus maliit na buffer.
    const bottomReserve = window.innerWidth <= 1024 ? 76 : 6;
    let available = Math.round(window.innerHeight - top - bottomReserve);
    // AYOS: huwag lumampas sa aktwal na espasyo sa loob ng #view-faq. Dati,
    // window.innerHeight lang ang batayan, kaya pagkatapos gumamit ng AI
    // Chatbot at bumalik sa FAQ, mas mataas ang box kaysa sa view
    // (overflow hidden) at nai-scroll ng browser ang view pataas, kaya
    // napupunta ang header ng resulta sa ilalim ng top toggles.
    const viewRect = view.getBoundingClientRect();
    const roomInView = Math.round(viewRect.bottom - top);
    if (viewRect.height > 0 && roomInView > 0 && roomInView < available) available = roomInView;
    box.style.minHeight = available > 0 ? `${available}px` : '';
  }


  // ---- floating layout: lumulutang ang top toggles at ang composer -----
  // Ang chat/FAQ area ay umaabot na sa likod ng top toggles (hanggang sa
  // gitna nila) at sa likod ng composer (hanggang sa gitna nito), kaya
  // nakikita ang laman sa mga gilid/kurba at mukhang talagang lumulutang
  // ang mga button at search/text box. Dahil nakapatong (overlay) ang mga
  // ito, sinusukat dito ang aktwal na taas nila at itinatakda bilang CSS
  // vars sa #view-faq: --faq-top-h (taas ng top bar + gap) at --faq-dock-h
  // (taas ng composer dock, kasama ang keyboard offset). Ginagamit ito ng
  // CSS (index.html, #faq-float-layout) bilang padding sa itaas/ibaba ng
  // scroll area para hindi matakpan ang unang/huling laman.
  // AYOS: FAQ (Search) mode lang. Ang #faq-ai-result mismo ang nag-i-scroll
  // (may padding-top na kasing-taas ng top toggles), kaya dapat laging
  // nasa scrollTop 0 ang simula ng resulta at hindi dapat gumalaw ang
  // mga parent (#faq-ai-box / #view-faq). Hindi ito ginagamit sa AI Chatbot.
  function keepFaqResultBelowToggles(resultBox) {
    if (!resultBox) return;
    const apply = () => {
      if (effectiveAiMode() === 'ai') return;
      resultBox.scrollTop = 0;
      const box = document.getElementById('faq-ai-box');
      const view = document.getElementById('view-faq');
      if (box && box.scrollTop) box.scrollTop = 0;
      if (view && view.scrollTop) view.scrollTop = 0;
    };
    apply();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    setTimeout(apply, 120);
  }
  // Guard: ang #faq-ai-box (overflow hidden) ay hindi dapat mag-scroll sa
  // FAQ mode — kapag may nag-scroll dito (hal. scrollIntoView ng browser
  // kapag lumabas ang keyboard) at natabunan ng toggles ang header, ibinabalik.
  function guardFaqBoxScroll() {
    const box = document.getElementById('faq-ai-box');
    if (!box || box._faqScrollGuard) return;
    box._faqScrollGuard = true;
    const viewEl = document.getElementById('view-faq');
    if (viewEl) {
      // ang #view-faq (overflow hidden) ay hindi rin dapat nai-scroll sa FAQ mode
      viewEl.addEventListener('scroll', () => {
        if (!viewEl.scrollTop) return;
        if (viewEl.classList.contains('faq-fullchat-mode')) return;
        if (effectiveAiMode() === 'ai') return;
        viewEl.scrollTop = 0;
      }, { passive: true });
    }
    box.addEventListener('scroll', () => {
      const view = document.getElementById('view-faq');
      if (!box.scrollTop) return;
      if (view && view.classList.contains('faq-fullchat-mode')) return;
      if (effectiveAiMode() === 'ai') return;
      box.scrollTop = 0;
    }, { passive: true });
  }

  let faqFloatLayoutWired = false;
  // itinatakda lang kapag nagbago, para hindi mag-loop ang MutationObserver
  function setFloatVar(view, name, value) {
    if (view.style.getPropertyValue(name) !== value) view.style.setProperty(name, value);
  }
  function syncFaqFloatVars() {
    const view = document.getElementById('view-faq');
    if (!view) return;
    const top = document.getElementById('faq-top-bar');
    const dock = document.getElementById('faq-composer-dock');
    if (top && top.offsetHeight > 0) {
      const mb = parseFloat(getComputedStyle(top).marginBottom) || 0;
      setFloatVar(view, '--faq-top-h', `${Math.round(top.offsetHeight + mb)}px`);
    }
    if (dock && dock.offsetHeight > 0) {
      setFloatVar(view, '--faq-dock-h', `${Math.round(dock.offsetHeight)}px`);
    }
  }
  function setupFaqFloatLayout() {
    if (faqFloatLayoutWired) return;
    faqFloatLayoutWired = true;
    guardFaqBoxScroll();
    const view = document.getElementById('view-faq');
    const top = document.getElementById('faq-top-bar');
    const dock = document.getElementById('faq-composer-dock');
    if (!view) return;
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => syncFaqFloatVars());
      if (top) ro.observe(top);
      if (dock) ro.observe(dock);
    }
    if (typeof MutationObserver === 'function') {
      // pagpalit ng mode/view (class/style) at pagbabago ng laman ng dock
      const mo = new MutationObserver(() => syncFaqFloatVars());
      mo.observe(view, { attributes: true, attributeFilter: ['class', 'style'] });
      if (dock) mo.observe(dock, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    }
    window.addEventListener('resize', syncFaqFloatVars);
    window.addEventListener('orientationchange', syncFaqFloatVars);
    syncFaqFloatVars();
    setTimeout(syncFaqFloatVars, 0);
    setTimeout(syncFaqFloatVars, 300);
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

  // ---- BAGO: "unanswered questions" local analytics log ----------------
  // Layunin: makilala kung anong mga tanong ang HINDI natutugunan nang
  // maayos ng knowledge base, para may basehan kung anong bagong FAQ
  // entries ang dapat idagdag — dating wala talagang tinatala nito,
  // basta na lang nawawala ang impormasyong iyon. Dalawang klase ng
  // "hindi natugunan" ang tinatala: (1) keyword search (kb mode, o AI
  // fallback) na walang eksakto/malapit na nahanap na sagot, at (2)
  // AI-generated na sagot na binigyan ng 👎 (thumbs down) na feedback.
  // Naka-save lang ito nang lokal sa browser (localStorage) — walang
  // ipinapadalang data kahit saan — kaya magagamit ito ng
  // admin/developer sa pamamagitan ng OmniFAQ.getUnansweredLog() sa dev
  // console habang naka-login sa device na iyon (o puwedeng i-export at
  // ipadala sa isang admin analytics page balang araw kung kailangan).
  const UNANSWERED_LOG_KEY = 'omnipos_faq_unanswered_log';
  const UNANSWERED_LOG_MAX = 200;

  function loadUnansweredLog() {
    try {
      const raw = localStorage.getItem(UNANSWERED_LOG_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function logUnansweredQuery(query, reason) {
    const q = (query || '').trim();
    if (!q) return;
    try {
      const log = loadUnansweredLog();
      log.push({ query: q, reason: reason || 'no_kb_result', lang: currentLang(), ts: new Date().toISOString() });
      localStorage.setItem(UNANSWERED_LOG_KEY, JSON.stringify(log.slice(-UNANSWERED_LOG_MAX)));
    } catch (e) {}
  }

  function clearUnansweredLog() {
    try { localStorage.removeItem(UNANSWERED_LOG_KEY); } catch (e) {}
  }

  // BAGO: "conversation compaction" — dati, ang historyPayload na
  // ipinapadala sa AI ay basta na lang ang HULING 8 turns
  // (chatHistory.slice(-8)) — kapag lampas na dito ang haba ng usapan,
  // buo-buong nawawala na lang (hindi na ipinapadala sa AI) ang
  // mas lumang bahagi, kahit relevant pa ito sa follow-up ng user
  // (hal. "yung una kong tinanong kanina..."). Dito, sa halip na basta
  // itapon ang mga mas lumang turn, gumagawa ng maigsing (extractive,
  // hindi AI-generated — walang dagdag na network call) na listahan ng
  // mga naunang tanong bilang isang solong "context" entry, at idinurugtong
  // ito bago ang huling 8 turns, para may kahit paalala pa rin ng buong
  // usapan ang AI kahit mahaba na ito.
  function summarizeOlderTurns(olderTurns) {
    const questions = olderTurns
      .filter(h => h.role === 'user' && h.text && h.text.trim())
      .map(h => h.text.trim().slice(0, 80));
    if (!questions.length) return null;
    const isTl = currentLang() === 'tl';
    const label = isTl
      ? 'Mga naunang tanong sa usapang ito (para lang sa konteksto, hindi kailangang sagutin ulit)'
      : 'Earlier questions already asked in this conversation (context only, no need to re-answer)';
    return { role: 'user', text: `[${label}]: ${questions.join(' | ')}` };
  }

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
    const label = effectiveAiMode() === 'ai' ? s.newConversation : s.newSearch;
    textEl.textContent = label;
    // Icon-only na ang button sa composer, kaya ang title/aria-label ang nagsasabi ng gamit nito.
    const btn = document.getElementById('faq-new-conversation-bottom');
    if (btn) { btn.title = label; btn.setAttribute('aria-label', label); }
  }

  function resetConversation() {
    // BUGFIX: dati, kahit nasa FAQ (Search/kb) mode ang user at "New
    // search" ang pinindot, binubura rin nito ang usapan sa AI Chatbot
    // (chatHistory + naka-save sa localStorage) — kaya pagbalik sa AI
    // mode, wala na ang conversation. Ngayon, magkahiwalay na ang
    // dalawa: ang "New search" ay nagre-reset LANG ng FAQ search
    // (resulta + search field + shortcuts), at hindi ginagalaw ang
    // AI chat history. Ang "New conversation" (AI mode) lang ang
    // nagbubura ng AI chat.
    if (effectiveAiMode() !== 'ai') {
      const kbResultBox = document.getElementById('faq-ai-result');
      if (kbResultBox) kbResultBox.innerHTML = '';
      const kbInput = document.getElementById('faq-ai-input');
      // (ang pag-set ng .value ay kusa nang nag-a-autosize ng textarea)
      if (kbInput) kbInput.value = '';
      hideSuggestions();
      activeSuggestIndex = -1;
      setKbShortcutsVisible(true);
      return;
    }

    // AI Chatbot mode: bagong usapan — buburahin ang buong AI chat.
    chatHistory = [];
    clearStoredChatHistory();
    const resultBox = document.getElementById('faq-ai-result');
    if (resultBox) resultBox.innerHTML = '';
    clearImage();
    renderChatEmptyStateIfNeeded();
  }

  function ensureThread(container) {
    let thread = container.querySelector('#faq-chat-thread');
    if (!thread) {
      container.innerHTML = '<div class="faq-chat-thread" id="faq-chat-thread"></div>';
      thread = container.querySelector('#faq-chat-thread');
    }
    // BAGO: floating "scroll to bottom" arrow — dating wala nito, kaya
    // kapag nag-scroll pataas ang user para balikan/basahin ang lumang
    // bahagi ng usapan, walang malinaw na paraan para makita (o
    // malaman) na may mas bago pa palang mensahe/sagot sa ibaba maliban
    // sa manual na pag-scroll pababa. Ipinapakita ito sa tuwing hindi
    // nasa (o malapit sa) pinaka-ilalim ng thread ang view.
    ensureScrollToBottomButton(container, thread);
    if (!thread._faqTailWired) {
      thread._faqTailWired = true;
      thread.style.overflowAnchor = 'none';
      if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(() => updateChatTailSpace(thread))
          .observe(thread, { childList: true, subtree: true, characterData: true });
      }
      window.addEventListener('resize', () => updateChatTailSpace(thread), { passive: true });
    }
    return thread;
  }

  // Idinudugtong bilang absolutely-positioned na sibling ng
  // .faq-chat-thread (hindi bahagi ng thread mismo), kaya hindi ito
  // naaapektuhan ng innerHTML rebuilds ng thread content, at hindi rin
  // ito nase-scroll palabas ng view kasabay ng mga bubble.
  function ensureScrollToBottomButton(container, thread) {
    let btn = container.querySelector('#faq-scroll-bottom-btn');
    if (btn) {
      updateScrollToBottomButton(thread);
      return btn;
    }
    const label = STRINGS().scrollToLatest;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'faq-scroll-bottom-btn';
    btn.className = 'faq-scroll-bottom-btn';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = '<i class="fa-solid fa-arrow-down"></i>';
    btn.addEventListener('click', () => {
      thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
    });
    container.appendChild(btn);
    thread.addEventListener('scroll', () => updateScrollToBottomButton(thread), { passive: true });
    // Sinusubaybayan ang laki ng laman ng thread (bagong bubble, o
    // lumalaking sagot habang tina-type-out) para awtomatikong
    // ma-update ang visibility ng buton kahit hindi mismo nag-scroll
    // ang user — hal. habang tuloy-tuloy pang lumalaki ang AI answer.
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => updateScrollToBottomButton(thread));
      observer.observe(thread, { childList: true, subtree: true, characterData: true });
    }
    updateScrollToBottomButton(thread);
    return btn;
  }

  function updateScrollToBottomButton(thread) {
    if (!thread) return;
    const container = thread.parentElement;
    const btn = container && container.querySelector('#faq-scroll-bottom-btn');
    if (!btn) return;
    const distanceFromBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    btn.classList.toggle('faq-scroll-bottom-btn-visible', distanceFromBottom > 48);
  }

  // BAGO: sa halip na basta i-jump ang scroll papuntang PINAKA-ILALIM
  // (scrollHeight) ng thread sa tuwing may bagong bubble (dating
  // gawi — nagtatabon ng bagong tanong ng user, at pinuputol ang simula
  // ng mahahabang sagot ng AI), dito ang simula/head mismo ng
  // ibinigay na bubble ang tinitiyak na makikita (block:'start') —
  // gumagana ito kapareho para sa user bubble (pagkatapos magsend) at
  // assistant bubble (pagsisimula ng sagot ng AI).
  function scrollBubbleIntoView(bubbleEl, thread, opts) {
    if (!bubbleEl) return;
    thread = thread || bubbleEl.closest('.faq-chat-thread');
    if (!thread) return;
    // AYOS: dati, bubbleEl.scrollIntoView() ang ginagamit dito. Ang
    // scrollIntoView ay nag-i-scroll ng LAHAT ng scrollable na parent (pati
    // ang buong page/main content), kaya lumilipat ang buong screen (lalo na
    // sa desktop) pagkatapos mag-send. Ngayon, ang loob LANG ng chat thread
    // ang ini-scroll, gamit ang sarili nitong scrollTo().
    //
    // Ang inaangklahan ay laging ang KASASEND lang na tanong ng user: kapag
    // assistant bubble ang ibinigay, hinahanap ang tanong na sinasagot nito.
    // Sa ganitong paraan, ang tanong ay nasa pinaka-itaas ng chat at ang
    // header ng sagot ng AI ay makikita agad sa ilalim nito.
    // BAGO: kapag dumating na ang sagot ng AI (opts.anchorSelf), ang HEAD
    // mismo ng sagot (ang assistant bubble) ang iaangat sa pinaka-itaas ng
    // chat, sa ilalim lang ng mga toggle — hindi na ang tanong ng user.
    const anchor = (opts && opts.anchorSelf) ? bubbleEl : findChatScrollAnchor(bubbleEl);
    thread._faqScrollAnchor = anchor;
    updateChatTailSpace(thread);
    const top = Math.max(0, getChatAnchorTop(anchor, thread));
    try {
      thread.scrollTo({ top, behavior: 'smooth' });
    } catch (e) {
      thread.scrollTop = top;
    }
    updateScrollToBottomButton(thread);
  }

  function findChatScrollAnchor(bubbleEl) {
    let el = bubbleEl;
    while (el) {
      if (el.classList && el.classList.contains('faq-chat-user')) return el;
      el = el.previousElementSibling;
    }
    return bubbleEl;
  }

  // Posisyon ng anchor sa loob ng scrollable na thread (walang paggalaw ng page).
  function getChatAnchorTop(anchor, thread) {
    // Ang tanong na sinend ay iniaakyat sa ILALIM LANG ng mga toggle sa
    // taas (hindi umaabot sa likod nila): ang padding-top ng thread ay
    // kasing-taas ng top bar (--faq-top-h), kaya doon ito humihinto.
    const cs = window.getComputedStyle(thread);
    const padTop = parseFloat(cs.paddingTop) || 0;
    return anchor.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop - padTop;
  }

  // Para maiakyat ang tanong sa pinaka-itaas kahit maikli pa ang sagot,
  // nilalagyan ng sapat na espasyo sa ibaba ang thread (padding-bottom).
  // Lumiliit ito habang humahaba ang sagot, at nagiging 0 kapag mahaba na.
  function updateChatTailSpace(thread) {
    if (!thread) return;
    // BUGFIX: dati, inline `padding-bottom` ang ginagamit dito, pero may
    // `padding-bottom: var(--faq-dock-h) !important` na sa CSS (para sa
    // floating composer) kaya hindi tumatama ang inline style — walang
    // dagdag na espasyo sa ilalim, kaya hindi makaakyat ang tanong sa
    // tuktok. Ngayon, CSS variable (--faq-tail-extra) ang ginagamit, at
    // nasa loob ito ng padding-bottom ng thread (see index.html,
    // #faq-float-layout).
    const anchor = thread._faqScrollAnchor;
    const curExtra = parseFloat(thread.style.getPropertyValue('--faq-tail-extra')) || 0;
    if (!anchor || !anchor.isConnected || anchor.parentElement !== thread) {
      if (curExtra) thread.style.removeProperty('--faq-tail-extra');
      return;
    }
    const naturalHeight = thread.scrollHeight - curExtra;
    const belowAnchor = naturalHeight - getChatAnchorTop(anchor, thread);
    const extra = Math.max(0, Math.ceil(thread.clientHeight - belowAnchor));
    if (Math.abs(extra - curExtra) < 1) return;
    if (extra > 0) thread.style.setProperty('--faq-tail-extra', extra + 'px');
    else thread.style.removeProperty('--faq-tail-extra');
  }

  // BAGO: ang mga attachment ay nasa ITAAS ng bubble (parang Claude) at ang text ay nasa ilalim.
  // Pwedeng i-click ang bawat attachment para sa preview.
  function appendUserBubble(thread, text, attachments) {
    const div = document.createElement('div');
    div.className = 'faq-chat-msg faq-chat-user';
    const list = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
    const strip = list.length
      ? `<div class="faq-chat-attachments">${list.map((x) => attachItemHtml(x, false)).join('')}</div>`
      : '';
    div.innerHTML = `${strip}<div class="faq-chat-bubble">${escapeHtml(text)}</div>`;
    if (list.length) {
      const stripEl = div.querySelector('.faq-chat-attachments');
      if (stripEl) {
        stripEl.addEventListener('click', (ev) => {
          const item = ev.target.closest ? ev.target.closest('.faq-att-item') : null;
          if (!item) return;
          const i = list.findIndex((x) => x.id === item.getAttribute('data-id'));
          if (i >= 0) openAttachPreview(list, i);
        });
        stripEl.addEventListener('keydown', (ev) => {
          if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('faq-att-item')) {
            ev.preventDefault();
            ev.target.click();
          }
        });
      }
    }
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

  // BUGFIX: dati, KAHIT ano ang dahilan ng pagpalya ng AI (naubos na ang
  // daily quota ng AI provider, timeout, walang internet, atbp.), iisa
  // lang ang lumalabas — "Omni AI is unavailable" + "Try again" — kaya
  // kapag talagang down ang provider, paulit-ulit at walang saysay ang
  // "Try again". Ngayon, itinatago rito ang dahilan ng huling pagpalya
  // para makapili ng tamang mensahe (at itago ang walang-saysay na
  // retry button kapag ang provider mismo ang naubusan ng quota).
  let lastAiFailure = null;

  function appendKbAnswerBubble(query, thread, wasAiAttempted) {
    const s = STRINGS();
    const providerDown = !!(wasAiAttempted && lastAiFailure && lastAiFailure.providerUnavailable);
    // Tunay na ubos na ang daily quota (RELAY-confirmed) — walang saysay ang Retry. Kapag pansamantalang error lang
    // (rate limit/capacity/outage), iba ang mensahe at may Retry button pa rin.
    const providerQuotaOut = !!(providerDown && lastAiFailure.providerExhausted);
    // Oras ng reset (PH time) mula sa retryAt ng RELAY — dati, "subukan ulit mamaya" lang ang sinasabi.
    let providerResetNote = '';
    if (providerQuotaOut && lastAiFailure.retryAt > Date.now()) {
      try {
        const t = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(lastAiFailure.retryAt));
        providerResetNote = ` ${currentLang() === 'tl' ? `Magre-reset ito mga ${t} PH time.` : `It resets around ${t} PH time.`}`;
      } catch (e) {}
    }
    const html = `
      ${wasAiAttempted ? `
        <div class="faq-ai-fallback-notice">
          <div class="faq-ai-fallback-msg"><i class="fa-solid fa-triangle-exclamation"></i> ${providerQuotaOut ? s.aiProviderDown + escapeHtml(providerResetNote) : (providerDown ? s.aiProviderBusy : s.aiFallbackNotice)}</div>
          ${providerQuotaOut ? '' : `<button type="button" class="faq-chip faq-retry-ai-btn" data-action="retry-ai">
            <i class="fa-solid fa-arrow-rotate-right"></i> ${s.regenerate}
          </button>`}
        </div>` : ''}
      <div class="faq-ai-badge"><i class="fa-solid fa-wand-magic-sparkles"></i> ${s.badge}</div>
      ${buildKbAnswerInnerHtml(query)}`;
    const bubble = appendAssistantBubble(thread, html);
    scrollBubbleIntoView(bubble, thread);
    wireBubbleFaqLinks(bubble);
    chatHistory.push({ role: 'assistant', text: stripHtml(buildKbAnswerInnerHtml(query)).slice(0, 500) });
    saveChatHistory();
    // BAGO: "Try again" button — kapag nag-fail ang Omni AI at
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
    });
  }

  function wireAiBubbleActions(bubble, query, answerText, thread, interactionId) {
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
      regenBtn.addEventListener('click', async () => {
        // Drop the stale assistant turn from memory, then re-ask.
        if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'assistant') {
          chatHistory.pop();
        }
        saveChatHistory();
        bubble.remove();
        // BUGFIX: dati, hindi naka-gate sa setSendButtonLoading ang "Try
        // again" (posibleng makapag-send ulit ang user habang nag-re-regenerate
        // pa), at kung mag-fail ang re-attempt, walang ipinapakitang kahit
        // ano (nawawala na lang ang loading bubble nang tahimik, walang KB
        // fallback/retry option) — kabaligtaran ng ginagawa ng
        // wireKbFallbackRetryAction sa ibabaw kapag nag-fail ang unang
        // tanong. Ginawa itong pareho dito.
        setSendButtonLoading(true);
        try {
          const handled = await askAIAssistantChat(query, thread);
          if (!handled) appendKbAnswerBubble(query, thread, true);
        } finally {
          setSendButtonLoading(false);
        }
        saveChatHistory();
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
          // BAGO: ipinapadala na sa server ang 👍/👎 (dati, 👎 lang ang
          // tinatala at sa browser lang) para lumabas sa AI analytics.
          // Fire-and-forget — hindi dapat maantala/masira ang UI kapag
          // nag-fail ang request.
          if (interactionId) {
            try {
              authFetch(`${API_URL}/ai-assistant/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ interactionId, vote: btn.dataset.vote }),
                timeoutMs: 10000
              }).catch(() => {});
            } catch (e) {}
          }
          if (btn.dataset.vote === 'down') {
            // BAGO: itala rin sa analytics log ang mga AI sagot na
            // binigyan ng 👎 — palatandaan ito na kahit nakasagot ang AI,
            // mali/kulang/hindi kasiya-siya ito para sa user, kaya
            // dapat ding suriin (hindi lang literal na "walang nahanap
            // na sagot" ang tinatala rito).
            logUnansweredQuery(query, 'ai_thumbs_down');
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

  // ---- attachment: screenshot (image) OR document (pdf/docx/txt/csv) ----
  // BAGO: maraming attachment kada tanong (hanggang MAX_ATTACH_IMAGES larawan + MAX_ATTACH_FILES dokumento).
  // Bawat item: { id, kind: 'image' | 'file', name, size, mime, dataUrl }
  const MAX_ATTACH_IMAGES = 4;
  const MAX_ATTACH_FILES = 3;
  let pendingAttachments = [];
  let attachSeq = 0;
  const DOC_EXT_RE = /\.(pdf|docx|txt|csv|md|log)$/i;
  function triggerAttach() {
    // FREE plan = text lang: bawal ang larawan/file (pinapatupad din ng RELAY).
    if (!aiAssistantUnlocked()) { alert(planStrings().freeNoAttach); return; }
    openAttachSheet();
  }

  // ---- "Add to chat" sheet (Camera / Photos / Files) --------------------
  // Parang sa Claude: bottom sheet na may 3 pagpipilian na diretso sa system
  // picker ng device. Web/PWA ito, kaya ang browser mismo ang nagbubukas ng
  // picker (hindi makakapag-listahan ang app ng mga larawan ng device):
  //   Camera = <input capture="environment"> -> bubukas agad ang camera app
  //   Photos = <input accept="image/*">       -> Photo Picker ng Android / Photos ng iOS
  //   Files  = <input accept="docs">          -> system file picker (PDF, DOCX, TXT, CSV)
  // Lahat ay dumadaan pa rin sa onImageSelected() kaya pareho ang validation/limits.
  const ATTACH_DOC_ACCEPT = '.pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,.csv,.md,.log,text/plain,text/csv';
  const ATTACH_STRINGS = {
    en: { title: 'Add to chat', camera: 'Camera', photos: 'Photos', files: 'Files', close: 'Close',
          remove: 'Remove attachment', previewTitle: 'Attachment preview', prev: 'Previous', next: 'Next',
          maxImages: 'You can attach up to 4 images per message.', maxFiles: 'You can attach up to 3 documents per message.',
          noPreview: 'No preview available for this file type.', openFile: 'Open file', downloadFile: 'Download',
          truncated: '… (preview truncated)', readFail: 'Could not read that file.' },
    tl: { title: 'Idagdag sa chat', camera: 'Camera', photos: 'Photos', files: 'Files', close: 'Isara',
          remove: 'Alisin ang attachment', previewTitle: 'Preview ng attachment', prev: 'Nakaraan', next: 'Susunod',
          maxImages: 'Hanggang 4 na larawan lang kada mensahe.', maxFiles: 'Hanggang 3 dokumento lang kada mensahe.',
          noPreview: 'Walang preview para sa ganitong uri ng file.', openFile: 'Buksan ang file', downloadFile: 'I-download',
          truncated: '… (pinaikli ang preview)', readFail: 'Hindi mabasa ang file na iyon.' }
  };
  function attachStr() { return ATTACH_STRINGS[currentLang() === 'tl' ? 'tl' : 'en']; }
  function ensureAttachSheetStyles() {
    if (document.getElementById('faq-attach-sheet-style')) return;
    const st = document.createElement('style');
    st.id = 'faq-attach-sheet-style';
    st.textContent = `
      .faq-attach-sheet { position: fixed; inset: 0; z-index: 100000; }
      .faq-attach-sheet-backdrop { position: absolute; inset: 0; background: rgba(15,23,42,0.45); opacity: 0; transition: opacity .18s ease; }
      .faq-attach-sheet-panel { position: absolute; left: 0; right: 0; bottom: 0; margin: 0 auto; max-width: 520px; box-sizing: border-box;
        background: var(--bg-card, #fff); color: var(--text-primary, #0f172a); border-radius: 22px 22px 0 0; padding: 8px 16px calc(18px + env(safe-area-inset-bottom, 0px));
        box-shadow: 0 -8px 30px rgba(0,0,0,0.25); transform: translateY(100%); transition: transform .22s ease; }
      .faq-attach-sheet.is-open .faq-attach-sheet-backdrop { opacity: 1; }
      .faq-attach-sheet.is-open .faq-attach-sheet-panel { transform: translateY(0); }
      .faq-attach-sheet-handle { width: 40px; height: 4px; border-radius: 2px; background: rgba(100,116,139,0.4); margin: 0 auto 8px; }
      .faq-attach-sheet-head { display: flex; align-items: center; justify-content: center; position: relative; min-height: 40px; margin-bottom: 10px; }
      .faq-attach-sheet-head h3 { margin: 0; font-size: 1.05rem; font-weight: 600; }
      .faq-attach-sheet-close { position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border: 0; border-radius: 50%;
        background: transparent; color: inherit; font-size: 1.1rem; cursor: pointer; }
      .faq-attach-sheet-grid { display: flex; gap: 10px; }
      .faq-attach-tile { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 6px; border: 0; border-radius: 16px;
        background: rgba(100,116,139,0.12); color: inherit; font-size: 0.95rem; font-weight: 500; cursor: pointer; -webkit-tap-highlight-color: transparent; }
      .faq-attach-tile:active { background: rgba(100,116,139,0.24); }
      .faq-attach-tile-ico { width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        background: rgba(100,116,139,0.18); font-size: 1.25rem; }
      body.dark-mode .faq-attach-sheet-panel, .dark .faq-attach-sheet-panel { background: var(--dm-surface, #1f2937); color: var(--dm-text-primary, #f5f5f7); }
      @media (min-width: 769px) {
        .faq-attach-sheet-panel { bottom: 50%; border-radius: 22px; transform: translateY(50%) scale(.96); opacity: 0; transition: transform .18s ease, opacity .18s ease; }
        .faq-attach-sheet.is-open .faq-attach-sheet-panel { transform: translateY(50%) scale(1); opacity: 1; }
        .faq-attach-sheet-handle { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .faq-attach-sheet-backdrop, .faq-attach-sheet-panel { transition: none; }
      }`;
    document.head.appendChild(st);
  }
  function getAttachInput(kind) {
    const id = 'faq-attach-input-' + kind;
    let el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('input');
    el.type = 'file';
    el.id = id;
    el.style.display = 'none';
    if (kind === 'camera') { el.accept = 'image/*'; el.setAttribute('capture', 'environment'); }
    else if (kind === 'photos') { el.accept = 'image/*'; el.multiple = true; }
    else { el.accept = ATTACH_DOC_ACCEPT; el.multiple = true; }
    el.addEventListener('change', onImageSelected);
    document.body.appendChild(el);
    return el;
  }
  function closeAttachSheet() {
    const sheet = document.getElementById('faq-attach-sheet');
    if (!sheet) return;
    document.removeEventListener('keydown', closeAttachSheet._onKey, true);
    sheet.classList.remove('is-open');
    setTimeout(() => { try { sheet.remove(); } catch (e) {} }, 220);
  }
  function openAttachSheet() {
    if (document.getElementById('faq-attach-sheet')) return;
    ensureAttachSheetStyles();
    const a = ATTACH_STRINGS[currentLang() === 'tl' ? 'tl' : 'en'];
    // Camera tile: touch devices lang (sa desktop, walang epekto ang capture at file picker lang ang lalabas).
    const hasCamera = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const tile = (kind, icon, label) => `<button type="button" class="faq-attach-tile" data-attach="${kind}"><span class="faq-attach-tile-ico"><i class="fa-solid ${icon}"></i></span><span>${escapeHtml(label)}</span></button>`;
    const sheet = document.createElement('div');
    sheet.id = 'faq-attach-sheet';
    sheet.className = 'faq-attach-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', a.title);
    sheet.innerHTML = `
      <div class="faq-attach-sheet-backdrop"></div>
      <div class="faq-attach-sheet-panel">
        <div class="faq-attach-sheet-handle"></div>
        <div class="faq-attach-sheet-head">
          <button type="button" class="faq-attach-sheet-close" aria-label="${escapeHtml(a.close)}"><i class="fa-solid fa-xmark"></i></button>
          <h3>${escapeHtml(a.title)}</h3>
        </div>
        <div class="faq-attach-sheet-grid">
          ${hasCamera ? tile('camera', 'fa-camera', a.camera) : ''}
          ${tile('photos', 'fa-image', a.photos)}
          ${tile('files', 'fa-file-arrow-up', a.files)}
        </div>
      </div>`;
    sheet.querySelector('.faq-attach-sheet-backdrop').addEventListener('click', closeAttachSheet);
    sheet.querySelector('.faq-attach-sheet-close').addEventListener('click', closeAttachSheet);
    sheet.querySelectorAll('[data-attach]').forEach((btn) => {
      btn.addEventListener('click', () => {
        // Dapat sabay sa tap ang input.click() (user gesture) — kaya una ito bago isara ang sheet.
        const input = getAttachInput(btn.dataset.attach);
        closeAttachSheet();
        input.click();
      });
    });
    closeAttachSheet._onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAttachSheet(); } };
    document.addEventListener('keydown', closeAttachSheet._onKey, true);
    document.body.appendChild(sheet);
    requestAnimationFrame(() => sheet.classList.add('is-open'));
  }
  // ---- mga helper ng attachment ------------------------------------------
  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function attachTypeLabel(att) {
    if (att.kind === 'image') {
      const m = /^image\/([a-z0-9.+-]+)/i.exec(att.mime || '');
      return (m ? m[1] : 'img').replace(/^jpeg$/i, 'jpg').replace(/^svg\+xml$/i, 'svg').toUpperCase().slice(0, 5);
    }
    const e = /\.([a-z0-9]{1,5})$/i.exec(att.name || '');
    return e ? e[1].toUpperCase() : 'FILE';
  }
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('read'));
      reader.readAsDataURL(file);
    });
  }
  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
  // Pinapaliit ang malalaking larawan (camera/screenshot) para magkasya ang maraming attachment sa isang request.
  // Kapag pumalya ang pagpapaliit, ang orihinal na file ang gagamitin.
  async function prepareImageDataUrl(file) {
    const original = await readFileAsDataUrl(file);
    if (file.size <= 800 * 1024 || /^image\/(gif|svg)/i.test(file.type || '')) return { dataUrl: original, mime: file.type || 'image/jpeg' };
    try {
      const img = await loadImageFromFile(file);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) throw new Error('size');
      const scale = Math.min(1, 2048 / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('ctx');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const out = canvas.toDataURL('image/jpeg', 0.85);
      if (out && out.indexOf('data:image/jpeg') === 0 && out.length < original.length) return { dataUrl: out, mime: 'image/jpeg' };
    } catch (e) { /* gamitin ang orihinal */ }
    return { dataUrl: original, mime: file.type || 'image/jpeg' };
  }
  function dataUrlToBytes(dataUrl) {
    const i = String(dataUrl || '').indexOf(',');
    const bin = atob(i === -1 ? '' : dataUrl.slice(i + 1));
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    return bytes;
  }
  function guessMime(att) {
    const m = /^data:([^;,]+)/i.exec(att.dataUrl || '');
    const fromData = m ? m[1].toLowerCase() : '';
    if (att.mime && att.mime !== 'application/octet-stream') return att.mime;
    if (/\.pdf$/i.test(att.name || '')) return 'application/pdf';
    if (/\.docx$/i.test(att.name || '')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (/\.(txt|log|md)$/i.test(att.name || '')) return 'text/plain';
    if (/\.csv$/i.test(att.name || '')) return 'text/csv';
    return fromData || 'application/octet-stream';
  }

  // ---- composer tray (nasa loob ng textbox, sa itaas ng text) ------------
  function attachItemHtml(att, removable) {
    const label = escapeHtml(att.name || '');
    const rm = removable
      ? `<button type="button" class="faq-att-remove" aria-label="${escapeHtml(attachStr().remove)}" title="${escapeHtml(attachStr().remove)}"><i class="fa-solid fa-xmark"></i></button>`
      : '';
    if (att.kind === 'image') {
      return `<div class="faq-att-item faq-att-image" data-id="${att.id}" role="button" tabindex="0" aria-label="${label}"><img src="${att.dataUrl}" alt="${label}" draggable="false">${rm}</div>`;
    }
    return `<div class="faq-att-item faq-att-file" data-id="${att.id}" role="button" tabindex="0" aria-label="${label}" title="${label}"><span class="faq-att-file-type">${escapeHtml(attachTypeLabel(att))}</span><span class="faq-att-file-name">${label}</span>${rm}</div>`;
  }
  function getAttachTray() {
    const tray = document.getElementById('faq-attach-tray');
    if (tray && !tray._faqWired) {
      tray._faqWired = true;
      tray.addEventListener('click', (ev) => {
        ev.stopPropagation(); // huwag mag-focus ang textarea / mag-trigger ng composer click
        const item = ev.target.closest ? ev.target.closest('.faq-att-item') : null;
        if (!item || !tray.contains(item)) return;
        const id = item.getAttribute('data-id');
        if (ev.target.closest('.faq-att-remove')) { ev.preventDefault(); removeAttachment(id); return; }
        const idx = pendingAttachments.findIndex((x) => x.id === id);
        if (idx >= 0) openAttachPreview(pendingAttachments.slice(), idx);
      });
      tray.addEventListener('keydown', (ev) => {
        if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('faq-att-item')) {
          ev.preventDefault();
          ev.target.click();
        }
      });
    }
    return tray;
  }
  function renderAttachTray(scrollToEnd) {
    const tray = getAttachTray();
    const has = pendingAttachments.length > 0;
    if (tray) {
      tray.innerHTML = has ? pendingAttachments.map((x) => attachItemHtml(x, true)).join('') : '';
      tray.style.display = has ? 'flex' : 'none';
      if (has && scrollToEnd) requestAnimationFrame(() => { tray.scrollLeft = tray.scrollWidth; });
    }
    const composer = document.getElementById('faq-composer');
    if (composer) composer.classList.toggle('has-attachments', has);
    document.getElementById('faq-attach-btn')?.classList.toggle('has-attachment', has);
  }
  function removeAttachment(id) {
    pendingAttachments = pendingAttachments.filter((x) => x.id !== id);
    renderAttachTray(false);
  }

  // ---- preview (fullscreen) ng attachment: composer at ipinadalang mensahe ----
  function closeAttachPreview() {
    const el = document.getElementById('faq-att-preview');
    if (!el) return;
    document.removeEventListener('keydown', closeAttachPreview._onKey, true);
    if (el._blobUrl) { try { URL.revokeObjectURL(el._blobUrl); } catch (e) {} }
    try { el.remove(); } catch (e) {}
  }
  function openAttachPreview(items, startIdx) {
    if (!items || !items.length) return;
    closeAttachPreview();
    const a = attachStr();
    const total = items.length;
    let idx = Math.min(Math.max(0, startIdx | 0), total - 1);
    const root = document.createElement('div');
    root.id = 'faq-att-preview';
    root.className = 'faq-att-preview';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', a.previewTitle);
    root.innerHTML = `
      <div class="faq-att-preview-backdrop"></div>
      <div class="faq-att-preview-panel">
        <div class="faq-att-preview-head">
          <button type="button" class="faq-att-preview-close" aria-label="${escapeHtml(a.close)}"><i class="fa-solid fa-xmark"></i></button>
          <div class="faq-att-preview-title"><span class="faq-att-preview-name"></span><span class="faq-att-preview-meta"></span></div>
        </div>
        <div class="faq-att-preview-body"></div>
        <button type="button" class="faq-att-preview-nav faq-att-prev" aria-label="${escapeHtml(a.prev)}"><i class="fa-solid fa-chevron-left"></i></button>
        <button type="button" class="faq-att-preview-nav faq-att-next" aria-label="${escapeHtml(a.next)}"><i class="fa-solid fa-chevron-right"></i></button>
      </div>`;
    const body = root.querySelector('.faq-att-preview-body');
    const nameEl = root.querySelector('.faq-att-preview-name');
    const metaEl = root.querySelector('.faq-att-preview-meta');
    const prevBtn = root.querySelector('.faq-att-prev');
    const nextBtn = root.querySelector('.faq-att-next');
    prevBtn.style.display = nextBtn.style.display = total > 1 ? '' : 'none';

    const showCard = (att, msg, blobUrl, allowDownload) => {
      const card = document.createElement('div');
      card.className = 'faq-att-preview-card';
      const ico = document.createElement('div');
      ico.className = 'faq-att-preview-card-ico';
      ico.innerHTML = '<i class="fa-solid fa-file-lines"></i>';
      const nm = document.createElement('div');
      nm.className = 'faq-att-preview-card-name';
      nm.textContent = att.name || 'attachment';
      card.appendChild(ico);
      card.appendChild(nm);
      if (msg) {
        const m = document.createElement('div');
        m.className = 'faq-att-preview-card-msg';
        m.textContent = msg;
        card.appendChild(m);
      }
      if (blobUrl) {
        const link = document.createElement('a');
        link.className = 'faq-att-preview-link';
        link.href = blobUrl;
        if (allowDownload) { link.setAttribute('download', att.name || 'attachment'); link.textContent = a.downloadFile; }
        else { link.target = '_blank'; link.rel = 'noopener'; link.textContent = a.openFile; }
        card.appendChild(link);
      }
      body.appendChild(card);
    };

    const renderCurrent = () => {
      if (root._blobUrl) { try { URL.revokeObjectURL(root._blobUrl); } catch (e) {} root._blobUrl = null; }
      body.innerHTML = '';
      body.scrollTop = 0;
      const att = items[idx];
      nameEl.textContent = att.name || (att.kind === 'image' ? 'image' : 'attachment');
      metaEl.textContent = [attachTypeLabel(att), att.size ? formatBytes(att.size) : '', total > 1 ? `${idx + 1}/${total}` : ''].filter(Boolean).join(' · ');
      if (att.kind === 'image') {
        const img = document.createElement('img');
        img.className = 'faq-att-preview-img';
        img.alt = att.name || '';
        img.src = att.dataUrl;
        body.appendChild(img);
        return;
      }
      const mime = guessMime(att);
      const isText = /^text\//i.test(mime) || /\.(txt|csv|md|log)$/i.test(att.name || '');
      try {
        const bytes = dataUrlToBytes(att.dataUrl);
        if (isText) {
          const LIMIT = 200000;
          let text = new TextDecoder('utf-8').decode(bytes.subarray(0, LIMIT));
          if (bytes.length > LIMIT) text += '\n' + a.truncated;
          const pre = document.createElement('pre');
          pre.className = 'faq-att-preview-text';
          pre.textContent = text;
          body.appendChild(pre);
          return;
        }
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
        root._blobUrl = blobUrl;
        if (mime === 'application/pdf') {
          const fine = !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
          if (fine) {
            const frame = document.createElement('iframe');
            frame.className = 'faq-att-preview-frame';
            frame.src = blobUrl;
            frame.setAttribute('title', att.name || 'PDF');
            body.appendChild(frame);
          } else {
            // Karamihan ng mobile browser ay hindi nagre-render ng PDF sa loob ng iframe — buksan sa viewer ng device.
            showCard(att, '', blobUrl, false);
          }
          return;
        }
        showCard(att, a.noPreview, blobUrl, true);
      } catch (e) {
        showCard(att, a.readFail, null, false);
      }
    };
    const go = (delta) => {
      if (total < 2) return;
      idx = (idx + delta + total) % total;
      renderCurrent();
    };

    root.querySelector('.faq-att-preview-backdrop').addEventListener('click', closeAttachPreview);
    root.querySelector('.faq-att-preview-close').addEventListener('click', closeAttachPreview);
    prevBtn.addEventListener('click', () => go(-1));
    nextBtn.addEventListener('click', () => go(1));
    // Pindutin ang blangkong bahagi sa paligid ng larawan = isara
    body.addEventListener('click', (ev) => { if (ev.target === body) closeAttachPreview(); });
    // Swipe pakaliwa/pakanan = nakaraan/susunod
    let sx = null, sy = null;
    body.addEventListener('touchstart', (ev) => {
      if (ev.touches.length !== 1) { sx = null; return; }
      sx = ev.touches[0].clientX; sy = ev.touches[0].clientY;
    }, { passive: true });
    body.addEventListener('touchend', (ev) => {
      if (sx === null || !ev.changedTouches.length) return;
      const dx = ev.changedTouches[0].clientX - sx;
      const dy = ev.changedTouches[0].clientY - sy;
      sx = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    }, { passive: true });
    closeAttachPreview._onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeAttachPreview(); }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); go(-1); }
      else if (e.key === 'ArrowRight') { e.stopPropagation(); go(1); }
    };
    document.addEventListener('keydown', closeAttachPreview._onKey, true);
    document.body.appendChild(root);
    renderCurrent();
  }

  async function onImageSelected(event) {
    const input = event.target;
    const files = Array.from((input && input.files) || []);
    if (input) input.value = '';
    if (!files.length) return;
    if (!aiAssistantUnlocked()) { alert(planStrings().freeNoAttach); return; }
    const s = STRINGS();
    const a = attachStr();
    const problems = [];
    const addProblem = (msg) => { if (msg && problems.indexOf(msg) === -1) problems.push(msg); };
    let added = 0;
    for (const file of files) {
      const isImage = (file.type || '').startsWith('image/');
      const maxBytes = isImage ? 20 * 1024 * 1024 : 8 * 1024 * 1024;
      if (file.size > maxBytes) {
        addProblem(isImage ? s.imageTooLarge : (s.fileTooLarge || 'That file is too large (max ~8MB).'));
        continue;
      }
      if (!isImage && !DOC_EXT_RE.test(file.name || '') && file.type !== 'application/pdf' &&
          file.type !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
          !(file.type || '').startsWith('text/')) {
        addProblem(s.fileUnsupported || 'Unsupported file type. Supported: images, PDF, DOCX, TXT, CSV.');
        continue;
      }
      const imgCount = pendingAttachments.filter((x) => x.kind === 'image').length;
      const fileCount = pendingAttachments.length - imgCount;
      if (isImage && imgCount >= MAX_ATTACH_IMAGES) { addProblem(a.maxImages); continue; }
      if (!isImage && fileCount >= MAX_ATTACH_FILES) { addProblem(a.maxFiles); continue; }
      try {
        let dataUrl, mime;
        if (isImage) {
          const prepared = await prepareImageDataUrl(file);
          dataUrl = prepared.dataUrl;
          mime = prepared.mime;
          // Ang server ay tumatanggap ng hanggang ~6MB (data URL) kada larawan.
          if (dataUrl.length > 5.8 * 1024 * 1024) { addProblem(s.imageTooLarge); continue; }
        } else {
          dataUrl = await readFileAsDataUrl(file);
          mime = file.type || '';
        }
        // Maaaring may nadagdag habang naghihintay ang pagbasa — suriin muli ang limit.
        const nowImg = pendingAttachments.filter((x) => x.kind === 'image').length;
        const nowFile = pendingAttachments.length - nowImg;
        if (isImage && nowImg >= MAX_ATTACH_IMAGES) { addProblem(a.maxImages); continue; }
        if (!isImage && nowFile >= MAX_ATTACH_FILES) { addProblem(a.maxFiles); continue; }
        pendingAttachments.push({
          id: 'att' + (++attachSeq),
          kind: isImage ? 'image' : 'file',
          name: file.name || (isImage ? 'image' : 'attachment'),
          size: file.size || 0,
          mime: mime,
          dataUrl: dataUrl
        });
        added++;
      } catch (e) {
        addProblem(a.readFail);
      }
    }
    if (added) renderAttachTray(true);
    if (problems.length) alert(problems.join('\n'));
  }
  function clearImage() {
    pendingAttachments = [];
    renderAttachTray(false);
  }

  // ---- AI credit/billing pill (top bar) ---------------------------------
  // Timer para sa "resets in ..." countdown: ina-update ang oras bawat minuto at
  // kumukuha ng bagong datos pagdating ng reset (dati, nakapako ang "resets in 3h 20m"
  // at nanatiling "exhausted" ang pill kahit lumipas na ang reset hanggang may ibang trigger).
  let aiPillResetTimer = null;
  async function refreshAiCreditPill(preloaded) {
    if (aiPillResetTimer) { clearTimeout(aiPillResetTimer); aiPillResetTimer = null; }
    const pill = document.getElementById('ai-assistant-credit-pill');
    if (!pill) { syncAiModelButton(false); return; }
    const syncWrap = () => { if (typeof window.syncAiCreditExpiryWrapper === 'function') window.syncAiCreditExpiryWrapper(); };
    // BAGO: hiling ng user — walang dapat makikitang AI credit/expiration
    // pill maliban sa AI Chatbot mode mismo (hindi sa Search/kb mode, at
    // hindi rin kapag naka-lock/hindi pa na-unlock ang Omni AI).
    if (!aiChatEnabled() || effectiveAiMode() !== 'ai') { pill.style.display = 'none'; syncWrap(); syncAiModelButton(false); return; }
    const s = STRINGS();
    syncAiModelButton(false);
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
        syncWrap();
        return;
      }
      const remaining = data.remaining;
      const limit = data.limit;
      pill.style.display = 'inline-flex';
      const ps = planStrings();
      // Ang daily limit ay NEURONS na (hindi na bilang ng tanong).
      const daily = data.daily && typeof data.daily.cap === 'number' && !data.daily.unlimited ? data.daily : null;
      const dailyDone = !!(daily && daily.used >= daily.cap);
      const fmtN = (n) => Number(n || 0).toLocaleString();
      // BAGO: babala kapag 80% o higit pa ng daily limit ang nagamit (o 15% na lang ang monthly credits).
      const dailyPct = daily && daily.cap > 0 ? daily.used / daily.cap : 0;
      const dailyWarn = !!(daily && !dailyDone && dailyPct >= 0.8);
      pill.classList.toggle('low', (limit > 0 && remaining / limit <= 0.15 && remaining > 0) || dailyWarn);
      pill.classList.toggle('exhausted', remaining <= 0 || dailyDone);
      // Oras ng reset sa orasan ng DEVICE: kung may resetsInMs galing RELAY, iyon ang gamit
      // (hindi apektado kapag mali ang oras/date ng device); kung wala, balik sa resetsAt.
      if (!data._rcvAt) data._rcvAt = Date.now();
      const resetLocalMs = daily
        ? (typeof daily.resetsInMs === 'number' ? data._rcvAt + daily.resetsInMs : Number(daily.resetsAt) || 0)
        : 0;
      const fmtReset = (ms) => {
        const m = Math.max(1, Math.ceil((Number(ms) - Date.now()) / 60000));
        return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
      };
      // Neurons ang ipinapakita (hindi tanong): natitira / kabuuang daily limit, compact (hal. 14.1k / 19k).
      const dailyLeft = daily ? (dailyDone ? 0 : Math.max(0, typeof daily.remaining === 'number' ? daily.remaining : daily.cap - daily.used)) : 0;
      const dailyText = !daily ? '' : ` · ${escapeHtml(ps.neuronsLeft.replace('{n}', fmtNeurons(dailyLeft)).replace('{c}', fmtNeurons(daily.cap)))}`;
      const resetText = (dailyDone && resetLocalMs) ? ` · ${escapeHtml(ps.resetsIn.replace('{t}', fmtReset(resetLocalMs)))}` : '';
      pill.innerHTML = `<i class="fa-solid fa-bolt"></i> ${escapeHtml(s.creditsLabel)}: ${remaining}/${limit}` +
        dailyText + resetText +
        (data.isFree ? ` · ${escapeHtml(ps.freeName)}` : (data.tier && data.tier.name ? ` · ${escapeHtml(data.tier.name)}` : ''));
      pill.title = dailyWarn ? ps.warn80 : ps.pillTitle;
      pill.style.cursor = 'pointer';
      // Habang ubos ang daily neurons: i-tick ang countdown bawat minuto (walang fetch), at pagdating
      // ng reset ay kumuha ng bagong status para mawala ang "exhausted".
      if (dailyDone && resetLocalMs) {
        const untilReset = resetLocalMs - Date.now();
        if (untilReset <= 0) {
          aiPillResetTimer = setTimeout(() => { aiPillResetTimer = null; refreshAiCreditPill().catch(() => {}); }, 15000);
        } else {
          aiPillResetTimer = setTimeout(() => {
            aiPillResetTimer = null;
            if (Date.now() >= resetLocalMs) refreshAiCreditPill().catch(() => {});
            else refreshAiCreditPill(data).catch(() => {});
          }, Math.min(60000, untilReset + 1500));
        }
      }
      if (!pill.dataset.planBound) {
        pill.dataset.planBound = '1';
        pill.addEventListener('click', () => openAiPlansModal());
      }
      syncWrap();
    } catch (e) {
      pill.style.display = 'none';
      syncWrap();
    }
  }

  // ---- quick action chips (diagnostic assistant / error explainer /
  // support-ticket assistant) --------------------------------------------
  function renderQuickActions() {
    const box = document.getElementById('faq-quick-actions');
    if (!box) return;
    if (!aiChatEnabled() || effectiveAiMode() !== 'ai') { box.innerHTML = ''; hideAiCreditRowNow(); syncQuickActionsToggle(); return; }
    const s = STRINGS();
    const creditRowOpen = !!document.getElementById('ai-assistant-credit-expiry')?.classList.contains('faq-credit-open');
    box.innerHTML = `
      <button type="button" class="faq-quick-action-chip" data-quick="diagnostics" title="${escapeHtml(s.quickDiagnostics)}" aria-label="${escapeHtml(s.quickDiagnostics)}"><i class="fa-solid fa-stethoscope"></i></button>
      <button type="button" class="faq-quick-action-chip" data-quick="explain-error" title="${escapeHtml(s.quickExplainError)}" aria-label="${escapeHtml(s.quickExplainError)}"><i class="fa-solid fa-bug"></i></button>
      <button type="button" class="faq-quick-action-chip" data-quick="ticket" title="${escapeHtml(s.quickTicket)}" aria-label="${escapeHtml(s.quickTicket)}"><i class="fa-solid fa-life-ring"></i></button>
      ${isCurrentUserAdmin() ? `<button type="button" class="faq-quick-action-chip" data-quick="insights" title="${escapeHtml(s.quickInsights)}" aria-label="${escapeHtml(s.quickInsights)}"><i class="fa-solid fa-chart-line"></i></button>` : ''}
      ${isCurrentUserAdmin() ? `<button type="button" class="faq-quick-action-chip" data-quick="tickets" title="${escapeHtml(s.quickTickets)}" aria-label="${escapeHtml(s.quickTickets)}"><i class="fa-solid fa-inbox"></i></button>` : ''}
      <button type="button" class="faq-quick-action-chip faq-credit-chip" data-quick="credits" title="${escapeHtml(s.quickCredits)}" aria-label="${escapeHtml(s.quickCredits)}" aria-controls="ai-assistant-credit-expiry" aria-expanded="${creditRowOpen ? 'true' : 'false'}"><i class="fa-solid fa-bolt"></i></button>`;
    box.querySelectorAll('[data-quick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.quick;
        hideQuickActionsNow();
        if (kind === 'diagnostics') { pendingDiagnosticsRequested = true; window.OmniFAQ.ask(STRINGS().diagnosticsQuestion); }
        else if (kind === 'explain-error') { pendingDiagnosticsRequested = true; window.OmniFAQ.ask(STRINGS().explainErrorQuestion); }
        else if (kind === 'ticket') { openTicketModal(); }
        else if (kind === 'insights') { openInsightsModal(); }
        else if (kind === 'tickets') { openTicketsListModal(); }
        else if (kind === 'credits') { showAiCreditRowTemporarily(); }
      });
    });
    syncQuickActionsToggle();
  }
  let pendingDiagnosticsRequested = false;

  // ---- quick actions: laging nakatago, lumalabas lang kapag pinindot ang
  // toggle button (katabi ng attach button sa composer), at kusang
  // nagtatago pagkalipas ng 3 segundo. Lumulutang ang row sa ibabaw ng
  // composer (CSS lang ang nagpapakita/nagtatago via .faq-quick-open),
  // kaya hindi nagbabago ang layout ng chat.
  const QUICK_ACTIONS_VISIBLE_MS = 3000;
  let quickActionsTimer = null;
  function setQuickActionsOpen(open) {
    const row = document.getElementById('faq-quick-actions-row');
    const btn = document.getElementById('faq-quick-toggle-btn');
    const hasChips = !!document.querySelector('#faq-quick-actions .faq-quick-action-chip');
    const willOpen = !!open && hasChips;
    if (quickActionsTimer) { clearTimeout(quickActionsTimer); quickActionsTimer = null; }
    if (row) row.classList.toggle('faq-quick-open', willOpen);
    if (btn) {
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      btn.classList.toggle('is-active', willOpen);
    }
    if (willOpen) {
      quickActionsTimer = setTimeout(() => {
        quickActionsTimer = null;
        setQuickActionsOpen(false);
      }, QUICK_ACTIONS_VISIBLE_MS);
    }
  }
  function hideQuickActionsNow() { setQuickActionsOpen(false); }
  function toggleQuickActions() {
    const row = document.getElementById('faq-quick-actions-row');
    if (!row) return;
    setQuickActionsOpen(!row.classList.contains('faq-quick-open'));
  }
  // Ipakita lang ang toggle button kung may laman ang quick actions
  // (AI Chatbot mode at naka-unlock ang Omni AI).
  function syncQuickActionsToggle() {
    const btn = document.getElementById('faq-quick-toggle-btn');
    const hasChips = !!document.querySelector('#faq-quick-actions .faq-quick-action-chip');
    if (btn) {
      btn.hidden = !hasChips;
      const label = STRINGS().quickActions || 'Quick actions';
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
    if (!hasChips) hideQuickActionsNow();
  }
  function setupQuickActionsToggle() {
    const btn = document.getElementById('faq-quick-toggle-btn');
    if (!btn || btn.dataset.quickReady === '1') return;
    btn.dataset.quickReady = '1';
    btn.addEventListener('click', toggleQuickActions);
    // Kapag nagta-type na ang user, itago agad para hindi matakpan ang suggestions.
    const input = document.getElementById('faq-ai-input');
    if (input) input.addEventListener('input', hideQuickActionsNow);
  }

  // ---- mobile-only: AI credit row (hidden by default) -------------------
  // Sa mobile view (<= 768px), nakatago ang AI credits/expiry row bilang
  // default. Ang credit chip (katabi ng Omni AI insights) ang naglalabas
  // nito sa ilalim ng mga toggle button (slide-down) sa loob ng 5 segundo,
  // tapos kusa itong bumabalik sa hide. Ang aktwal na pagtago/pagpapakita
  // ay CSS lang (.faq-credit-open sa style.css, mobile media query lang);
  // sa desktop/tablet ay walang epekto ang class na ito.
  const AI_CREDIT_ROW_VISIBLE_MS = 5000;
  let aiCreditRowTimer = null;
  function setAiCreditRowOpen(open) {
    const wrap = document.getElementById('ai-assistant-credit-expiry');
    if (wrap) wrap.classList.toggle('faq-credit-open', !!open);
    document.querySelectorAll('[data-quick="credits"]').forEach(b => b.setAttribute('aria-expanded', open ? 'true' : 'false'));
  }
  function hideAiCreditRowNow() {
    if (aiCreditRowTimer) { clearTimeout(aiCreditRowTimer); aiCreditRowTimer = null; }
    setAiCreditRowOpen(false);
  }
  function showAiCreditRowTemporarily() {
    if (aiCreditRowTimer) clearTimeout(aiCreditRowTimer);
    setAiCreditRowOpen(true);
    // i-refresh ang bilang ng credits para laging bago ang makikita.
    Promise.resolve(refreshAiCreditPill()).catch(() => {});
    aiCreditRowTimer = setTimeout(() => {
      aiCreditRowTimer = null;
      setAiCreditRowOpen(false);
    }, AI_CREDIT_ROW_VISIBLE_MS);
  }


  // BAGO: Omni AI Insights (Admin lang). Dati, kinakalkula na ng server
  // (/api/ai-assistant/analytics) ang stats pero walang screen na
  // nagpapakita nito. Ang server pa rin ang nagba-block sa non-admin
  // (403) — ang pag-check dito sa client ay para lang itago ang button.
  function isCurrentUserAdmin() {
    try {
      const u = JSON.parse(localStorage.getItem('omnipos_user') || 'null');
      return !!(u && String(u.role || '').toLowerCase() === 'admin');
    } catch (e) { return false; }
  }

  async function openInsightsModal() {
    const s = STRINGS();
    // canReset = show the Reset button (only when the insights loaded fine).
    const showHtml = async (html, canReset) => {
      if (window.Swal && typeof window.Swal.fire === 'function') {
        const r = await window.Swal.fire({
          title: s.insTitle, html, width: 560, confirmButtonText: s.insClose,
          showDenyButton: !!canReset, denyButtonText: s.insReset, denyButtonColor: '#dc2626'
        });
        if (r && r.isDenied) await resetInsights();
      } else {
        alert(html.replace(/<[^>]+>/g, ' '));
      }
    };
    const resetInsights = async () => {
      const ask = await window.Swal.fire({ title: s.insResetTitle, text: s.insResetText, icon: 'warning', showCancelButton: true, confirmButtonText: s.insResetConfirm, cancelButtonText: s.insClose, confirmButtonColor: '#dc2626' });
      if (!ask.isConfirmed) { openInsightsModal(); return; } // back to the insights
      try {
        const r = await authFetch(`${API_URL}/ai-assistant/analytics`, { method: 'DELETE', timeoutMs: 15000 });
        const out = await r.json().catch(() => null);
        if (!r.ok || !out || out.success === false) { await window.Swal.fire({ icon: 'error', text: (out && out.message) || s.insResetError, confirmButtonText: s.insClose }); }
      } catch (e) {
        await window.Swal.fire({ icon: 'error', text: s.insResetError, confirmButtonText: s.insClose });
      }
      openInsightsModal(); // reload (now empty)
    };
    try {
      const res = await authFetch(`${API_URL}/ai-assistant/analytics`, { timeoutMs: 15000 });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d || d.success === false) { showHtml(`<p>${escapeHtml((d && d.message) || s.insError)}</p>`); return; }
      const stat = (label, value) => `<div style="flex:1;min-width:120px;background:rgba(100,116,139,0.1);border-radius:10px;padding:8px 10px;text-align:center;"><div style="font-size:1.15rem;font-weight:700;">${escapeHtml(String(value))}</div><div style="font-size:0.72rem;opacity:0.75;">${escapeHtml(label)}</div></div>`;
      const list = (rows, fmt) => rows && rows.length
        ? `<ul style="margin:4px 0 0;padding-left:18px;">${rows.map(r => `<li>${fmt(r)}</li>`).join('')}</ul>`
        : `<div style="opacity:0.6;">${escapeHtml(s.insNone)}</div>`;
      const section = (title, body) => `<div style="margin-top:12px;"><strong>${escapeHtml(title)}</strong>${body}</div>`;
      const rated = (d.thumbsUp || 0) + (d.thumbsDown || 0);
      const helpful = d.helpfulRate === null || d.helpfulRate === undefined ? '—' : `${d.helpfulRate}% (${rated} ${s.insRated})`;
      const html = `<div style="text-align:left;font-size:0.85rem;">
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${stat(s.insTotal, d.totalQuestions || 0)}
          ${stat(s.insAnswered, `${d.answerRate || 0}%`)}
          ${stat(s.insHelpful, helpful)}
          ${stat(s.insAvg, `${((d.avgTookMs || 0) / 1000).toFixed(1)}s`)}
        </div>
        ${section(s.insTop, list(d.topQuestions, r => `${escapeHtml(r.question)} <span style="opacity:0.6;">×${r.count}</span>`))}
        ${section(s.insDown, list(d.topDownvoted, r => `${escapeHtml(r.question)} <span style="opacity:0.6;">×${r.count}</span>`))}
        ${section(s.insFailed, list(d.unansweredRecent, r => escapeHtml(r.question || '')))}
      </div>`;
      showHtml(html, true);
    } catch (e) {
      showHtml(`<p>${escapeHtml(s.insError)}</p>`);
    }
  }

  // ---- support tickets list (Admin) ------------------------------------
  // Lists the tickets saved on this server, including whether each one
  // reached the developer (RELAY) and the developer's status/reply.
  async function openTicketsListModal() {
    const s = STRINGS();
    const showHtml = (html, didOpen) => {
      if (window.Swal && typeof window.Swal.fire === 'function') {
        window.Swal.fire({ title: s.tkTitle, html, width: 620, confirmButtonText: s.insClose, didOpen });
      } else {
        alert(html.replace(/<[^>]+>/g, ' '));
      }
    };
    const statusLabel = (v) => ({ open: s.tkStOpen, in_progress: s.tkStProg, resolved: s.tkStResolved, closed: s.tkStClosed }[v] || String(v || ''));
    try {
      const res = await authFetch(`${API_URL}/support-tickets`, { timeoutMs: 30000 });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d || d.success === false || !Array.isArray(d.tickets)) {
        showHtml(`<p>${escapeHtml((d && d.message) || s.tkError)}</p>`);
        return;
      }
      if (!d.tickets.length) { showHtml(`<p>${escapeHtml(s.tkNone)}</p>`); return; }
      const shown = d.tickets.slice(0, 50);
      const rows = shown.map((t) => {
        let sync;
        if (t.relaySynced) sync = s.tkSentToDev + (t.relayStatus ? ` — ${s.tkDevStatus}: ${statusLabel(t.relayStatus)}` : '');
        else if (t.relaySyncFailed) sync = s.tkSyncFailed;
        else if (!d.relayConfigured) sync = s.tkNoRelay;
        else if (!(d.supportDesk && d.supportDesk.open)) sync = s.tkDeskClosed;
        else sync = s.tkQueued;
        const when = t.createdAt ? new Date(t.createdAt).toLocaleString() : '';
        const options = ['open', 'in_progress', 'resolved', 'closed']
          .map((v) => `<option value="${v}"${t.status === v ? ' selected' : ''}>${escapeHtml(statusLabel(v))}</option>`).join('');
        const msg = String(t.message || '').slice(0, 300);
        const reply = t.relayNote
          ? `<div class="faq-tk-reply"><strong>${escapeHtml(s.tkDevReply)}:</strong> <span>${escapeHtml(t.relayNote)}</span></div>`
          : '';
        return `<div class="faq-tk-card">
          <div class="faq-tk-head"><strong>${escapeHtml(t.subject || '')}</strong><span class="faq-tk-time">${escapeHtml(when)}</span></div>
          <div class="faq-tk-meta">${escapeHtml(t.username || '')} • ${escapeHtml(sync)}</div>
          ${msg ? `<div class="faq-tk-msg">${escapeHtml(msg)}</div>` : ''}
          ${reply}
          <div class="faq-tk-status-row"><span>${escapeHtml(s.tkYourStatus)}:</span><select class="faq-tk-select" data-ticket-id="${escapeHtml(String(t.id))}">${options}</select><button type="button" class="faq-tk-delete" data-delete-ticket="${escapeHtml(String(t.id))}" data-synced="${t.relaySynced ? '1' : '0'}"><i class="fa-solid fa-trash"></i> ${escapeHtml(s.tkDelete)}</button></div>
        </div>`;
      }).join('');
      const more = d.tickets.length > shown.length ? `<div class="faq-tk-meta" style="margin-top:8px;">${escapeHtml(s.tkMore)}</div>` : '';
      const deskOpen = !!(d.supportDesk && d.supportDesk.open);
      const banner = (d.relayConfigured && !deskOpen)
        ? `<div class="faq-tk-banner">${escapeHtml((d.supportDesk && d.supportDesk.message) || s.tkDeskBanner)}</div>`
        : '';
      showHtml(`<div class="faq-tk-wrap">${banner}${rows}${more}</div>`, (popup) => {
        popup.querySelectorAll('select[data-ticket-id]').forEach((sel) => {
          sel.dataset.prev = sel.value;
          sel.addEventListener('change', async () => {
            const prev = sel.dataset.prev;
            try {
              const r = await authFetch(`${API_URL}/support-tickets/${encodeURIComponent(sel.dataset.ticketId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: sel.value })
              });
              const out = await r.json().catch(() => null);
              if (!r.ok || !out || out.success === false) { sel.value = prev; alert((out && out.message) || s.tkSaveError); }
              else sel.dataset.prev = sel.value;
            } catch (e) {
              sel.value = prev;
              alert(s.tkSaveError);
            }
          });
        });
        popup.querySelectorAll('button[data-delete-ticket]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const synced = btn.dataset.synced === '1';
            const detail = `${s.tkDeleteText} ${synced ? s.tkDeleteSent : s.tkDeleteUnsent}`;
            let confirmed = false;
            if (window.Swal && typeof window.Swal.fire === 'function') {
              const r = await window.Swal.fire({ title: s.tkDeleteTitle, text: detail, icon: 'warning', showCancelButton: true, confirmButtonText: s.tkDeleteConfirm, cancelButtonText: s.tkDeleteCancel, confirmButtonColor: '#dc2626' });
              confirmed = !!r.isConfirmed;
            } else {
              confirmed = window.confirm(`${s.tkDeleteTitle}\n${detail}`);
            }
            if (!confirmed) { openTicketsListModal(); return; } // pinalitan ng confirm ang listahan, ibalik ito
            try {
              const r = await authFetch(`${API_URL}/support-tickets/${encodeURIComponent(btn.dataset.deleteTicket)}`, { method: 'DELETE' });
              const out = await r.json().catch(() => null);
              if (!r.ok || !out || out.success === false) { alert((out && out.message) || s.tkDeleteError); }
            } catch (e) {
              alert(s.tkDeleteError);
            }
            openTicketsListModal(); // i-reload ang listahan
          });
        });
      });
    } catch (e) {
      showHtml(`<p>${escapeHtml(s.tkError)}</p>`);
    }
  }

  function refreshTicketButtonVisibility() {
    const btn = document.getElementById('faq-ticket-btn');
    // BAGO: naka-tali ang Support Ticket sa "kasalukuyang AI
    // conversation" (see ticketHint), kaya walang saysay ipakita ito sa
    // Search (kb) mode kung saan wala namang multi-turn na usapan.
    if (btn) btn.style.display = (aiAssistantUnlocked() && effectiveAiMode() === 'ai') ? 'inline-flex' : 'none';
  }

  // ---- suggested "safe action" chips (navigate only, never a
  // data-changing action) under an AI answer ------------------------------
  // BAGO: ang mga Settings tab (sa loob ng Settings/Users page) na puwedeng
  // puntahan ng suggested-action chip. Key = panel ID ("tab" na galing sa
  // server), value = ID ng tab button sa index.html. Ang pag-click sa
  // mismong button ang ginagamit (parehong ginagawa ng user) para tumakbo
  // rin ang permission check at ang load function ng bawat tab.
  const OMNI_SETTINGS_TAB_BUTTONS = {
    'manage-users-tab': 'manage-users-tab-btn',
    'pending-requests-tab': 'pending-requests-counter-tab',
    'roles-permissions-tab': 'roles-permissions-tab-btn',
    'receipt-custom-tab': 'receipt-custom-tab-btn',
    'store-settings-tab': 'store-settings-tab-btn',
    'ux-settings-tab': 'ux-settings-tab-btn',
    'advanced-settings-tab': 'advanced-settings-tab-btn',
    'online-payments-tab': 'online-payments-tab-btn',
    'fraud-alerts-tab': 'fraud-alerts-counter-tab',
    'reset-restore-panel': 'reset-restore-btn'
  };

  // BAGO: whitelist ng lahat ng page (view) na puwedeng puntahan ng chip.
  // Value = permission key na ginagamit ng switchView() sa app.js para sa
  // view na iyon (batchlots -> products, gaya ng sa switchView), o null kung
  // walang hiwalay na permission. Ang view na wala sa listahang ito ay hindi
  // ipinapakita kahit ipadala ng server.
  const OMNI_SUGGESTED_VIEWS = {
    overview: 'overview',
    terminal: 'terminal',
    dashboard: 'dashboard',
    products: 'products',
    barcode: 'barcode',
    stock_return_inspection: 'stock_return_inspection',
    batchlots: 'products',
    reorder: 'reorder',
    transactions: 'transactions',
    bir_compliance: 'bir_compliance',
    reports: 'reports',
    customers: 'customers',
    debts: 'debts',
    shiftreport: 'shiftreport',
    branches: 'branches',
    attendance: 'attendance',
    remoteops: 'remoteops',
    logs: 'logs',
    users: 'users',
    faq: null,
    cloudtokens: null // Admin-only, hindi bahagi ng Roles & Permissions
  };
  const OMNI_ADMIN_ONLY_VIEWS = { cloudtokens: true };

  // Itinatago ang chip papunta sa page/Settings tab na hindi naman papayagang
  // buksan ng role ng user (para hindi siya mapunta sa maling page). Sinusunod
  // ang parehong patakaran ng switchView() at isUserTabAllowed() sa app.js.
  function isSuggestedActionAllowed(a) {
    if (!a || !a.view) return false;
    if (!Object.prototype.hasOwnProperty.call(OMNI_SUGGESTED_VIEWS, a.view)) return false;
    if (a.tab && !Object.prototype.hasOwnProperty.call(OMNI_SETTINGS_TAB_BUTTONS, a.tab)) return false;
    if (a.tab && a.view !== 'users') return false;
    try {
      const user = JSON.parse(localStorage.getItem('omnipos_user') || 'null');
      const isAdmin = ((user && user.role) || '').toLowerCase() === 'admin';
      if (isAdmin) return true;
      if (OMNI_ADMIN_ONLY_VIEWS[a.view]) return false;
      const permKey = OMNI_SUGGESTED_VIEWS[a.view];
      if (permKey && typeof currentPermissions !== 'undefined' && currentPermissions
          && Object.prototype.hasOwnProperty.call(currentPermissions, permKey)
          && !currentPermissions[permKey]) return false;
      if (a.tab && typeof window.isUserTabAllowed === 'function' && !window.isUserTabAllowed(a.tab)) return false;
    } catch (e) { /* kapag hindi mabasa ang user/permissions, ipakita pa rin ang chip; switchView pa rin ang final na gate */ }
    return true;
  }

  // BAGO: premium feature na kailangan ng bawat page/tab — galing sa
  // sariling listahan ng client (hindi pinagkakatiwalaan ang featureId na
  // galing sa server para sa pag-open ng purchase modal). Kapareho ito ng
  // VIEW_FEATURE_MAP sa switchView() ng app.js. Sinadyang WALA ang shiftreport
  // dito: may sarili itong special na patakaran (guardShiftReportAccess) na
  // pinapayagan pa rin ang admin/naka-open na shift, kaya switchView na ang
  // bahala roon.
  const OMNI_VIEW_FEATURES = {
    customers: 'customer_crm',
    debts: 'customer_crm',
    reports: 'advanced_reports',
    reorder: 'purchase_orders',
    branches: 'multi_branch',
    attendance: 'remote_operations',
    remoteops: 'remote_operations',
    batchlots: 'batch_lot_tracking'
  };
  const OMNI_TAB_FEATURES = { 'roles-permissions-tab': 'rbac_management' };
  const OMNI_SUBSCRIPTION_FEATURES = { rbac_management: true, multi_branch: true, remote_operations: true, ai_assistant: true };

  function suggestedActionFeatureId(a) {
    if (!a) return null;
    if (a.tab && Object.prototype.hasOwnProperty.call(OMNI_TAB_FEATURES, a.tab)) return OMNI_TAB_FEATURES[a.tab];
    if (Object.prototype.hasOwnProperty.call(OMNI_VIEW_FEATURES, a.view)) return OMNI_VIEW_FEATURES[a.view];
    return null;
  }

  // Naka-lock ba ang feature? Ang server ang batayan (may sariling listahan
  // ng unlocked features); kung wala siyang ibinigay, ang cache ng app.js
  // (kung na-load na) ang gagamitin.
  function isSuggestedActionLocked(a) {
    const featureId = suggestedActionFeatureId(a);
    if (!featureId) return false;
    if (typeof a.locked === 'boolean') return a.locked;
    try {
      if (typeof isFeatureUnlockedCached === 'function' && typeof unlockedFeatureIdsCache !== 'undefined'
          && Array.isArray(unlockedFeatureIdsCache)) {
        return !isFeatureUnlockedCached(featureId);
      }
    } catch (e) { /* hindi mabasa ang cache — huwag mag-claim ng lock */ }
    return false;
  }

  function suggestedActionFeatureName(a, featureId) {
    if (a && typeof a.featureName === 'string' && a.featureName.trim()) return a.featureName.trim().slice(0, 120);
    try {
      if (typeof PREMIUM_FEATURE_FALLBACK !== 'undefined' && PREMIUM_FEATURE_FALLBACK[featureId] && PREMIUM_FEATURE_FALLBACK[featureId].name) {
        return PREMIUM_FEATURE_FALLBACK[featureId].name;
      }
    } catch (e) { /* fallback sa ID */ }
    return featureId;
  }

  function ensureSuggestedLockStyles() {
    if (document.getElementById('faq-suggested-lock-styles')) return;
    const st = document.createElement('style');
    st.id = 'faq-suggested-lock-styles';
    st.textContent = `
      .faq-suggested-action-btn.is-locked { border-color: #d97706; color: #b45309; background: rgba(245,158,11,0.10); }
      .faq-suggested-action-btn.is-locked:hover { background: #d97706; color: #fff; }
      .faq-suggested-lock-note { display: flex; align-items: flex-start; gap: 8px; margin-top: 10px; padding: 8px 10px; font-size: 0.78rem; line-height: 1.4; border-radius: 8px; border: 1px solid rgba(217,119,6,0.35); background: rgba(245,158,11,0.08); color: #92400e; }
      .faq-suggested-lock-note i { margin-top: 2px; }
      body.dark-mode .faq-suggested-action-btn.is-locked, .dark .faq-suggested-action-btn.is-locked { color: #fbbf24; border-color: #f59e0b; }
      body.dark-mode .faq-suggested-lock-note, .dark .faq-suggested-lock-note { color: #fcd34d; }
    `;
    document.head.appendChild(st);
  }

  function openSuggestedAction(a) {
    // BAGO: kapag naka-lock ang premium feature, HINDI dinidiretso ang page —
    // ang purchase/subscription modal ng app ang bubukas (guardPremiumFeature).
    // Kung nabili na pala ito mula nang lumabas ang chip, ibabalik nito
    // ang false at tuloy ang normal na pagbukas ng page sa ibaba.
    const featureId = suggestedActionFeatureId(a);
    if (featureId && isSuggestedActionLocked(a) && typeof window.guardPremiumFeature === 'function') {
      try {
        if (window.guardPremiumFeature(featureId) === true) return;
      } catch (e) { /* kung pumalya ang modal, switchView pa rin ang final gate sa ibaba */ }
    }
    if (typeof window.switchView === 'function') window.switchView(a.view);
    const tabBtnId = a.tab ? OMNI_SETTINGS_TAB_BUTTONS[a.tab] : null;
    if (!tabBtnId) return;
    // Parehong pattern ng ibang "open settings" shortcut sa app.js: hintayin
    // munang ma-render/ma-refresh ng switchView ang page bago pindutin ang tab.
    setTimeout(() => {
      const viewEl = document.getElementById('view-' + a.view);
      if (!viewEl || viewEl.style.display === 'none') return; // na-redirect ng permission/feature gate
      const tabBtn = document.getElementById(tabBtnId);
      if (tabBtn) tabBtn.click();
    }, 50);
  }

  function renderSuggestedActions(container, actions) {
    if (!Array.isArray(actions)) return;
    const allowed = actions.filter(isSuggestedActionAllowed);
    if (!allowed.length) return;
    ensureSuggestedLockStyles();
    const s = STRINGS();
    const wrap = document.createElement('div');
    wrap.className = 'faq-suggested-actions';
    const notes = [];
    const notedFeatures = {};
    allowed.forEach(a => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'faq-suggested-action-btn';
      // Tinatanggal ang nangunguna na "Open " sa label para hindi maging
      // "Go to Open Users" / "Pumunta sa Open Users".
      const shownLabel = String(a.label || a.view).replace(/^Open\s+/i, '');
      const featureId = suggestedActionFeatureId(a);
      if (featureId && isSuggestedActionLocked(a)) {
        btn.classList.add('is-locked');
        btn.innerHTML = `<i class="fa-solid fa-lock"></i> ${escapeHtml(s.unlockTo)} ${escapeHtml(shownLabel)}`;
        if (!notedFeatures[featureId]) {
          notedFeatures[featureId] = true;
          const name = suggestedActionFeatureName(a, featureId);
          const isSub = typeof a.isSubscription === 'boolean' ? a.isSubscription : !!OMNI_SUBSCRIPTION_FEATURES[featureId];
          notes.push((isSub ? s.lockedNoteSubscription : s.lockedNoteOneTime).replace('{name}', () => name));
        }
      } else {
        btn.innerHTML = `<i class="fa-solid fa-arrow-right"></i> ${escapeHtml(s.goTo)} ${escapeHtml(shownLabel)}`;
      }
      btn.addEventListener('click', () => openSuggestedAction(a));
      wrap.appendChild(btn);
    });
    container.appendChild(wrap);
    notes.forEach(text => {
      const note = document.createElement('div');
      note.className = 'faq-suggested-lock-note';
      note.innerHTML = `<i class="fa-solid fa-lock"></i><span>${escapeHtml(text)}</span>`;
      container.appendChild(note);
    });
  }

  // ---- support ticket modal ---------------------------------------------
  // ---- AI plans (Base/Plus/Pro, daily limit = NEURONS) — RELAY-controlled ---------------
  // Lahat ng presyo/limits ay galing sa RELAY (/api/ai-assistant/plans);
  // walang naka-hardcode na presyo dito.
  const PLAN_STRINGS = {
    en: {
      upgradeBtn: 'Upgrade AI plan', today: 'today', pillTitle: 'Tap to see Omni AI plans',
      title: 'Omni AI Plans', loading: 'Loading plans...', loadError: 'Could not load the plans right now. Please try again later.',
      current: 'Current plan', none: 'Base (included with your subscription)', inclSub: 'Included with subscription', perMonth: 'credits / month', perDay: 'neurons / day', neurons: 'neurons', unlimited: 'Unlimited',
      tokens: 'Omni Tokens', upgradeFor: 'Upgrade for', balance: 'Your balance', buy: 'Choose', owned: 'Active', validUntil: 'Valid until',
      free: 'Free', noPlans: 'No upgrade plans are available right now.', adminPwTitle: 'Admin approval', adminPwText: 'Enter an admin password to buy the {name} plan for {cost} Omni Tokens.',
      adminPwPlaceholder: 'Admin password', confirm: 'Buy', cancel: 'Cancel', buying: 'Activating...', close: 'Close',
      successTitle: 'Plan activated', failTitle: 'Could not activate the plan', insufficient: 'Not enough Omni Tokens. Buy more tokens first.',
      modelTitle: 'AI model', modelHint: 'Choose which model answers your questions. Standard is the default.', modelDefault: 'Standard', modelDefaultDesc: 'Default model',
      modelSelected: 'Selected', modelUse: 'Use', modelRequires: 'Requires the {tier} plan', modelUnavailable: 'Not available right now',
      modelDescFlashLite: 'Fast and light', modelDescFlash: 'Smarter, for harder questions', modelDescPro: 'Most capable, for the hardest questions',
      modelBtnTitle: 'AI model and plan', upgradeShort: 'Upgrade', modelLoading: 'Loading...',
      freeName: 'Free', freeNone: 'Free', freeNote: 'Free plan: text questions only (no image/file attachments or model choice). Subscribe to Omni AI to get Base, Plus and Pro with smarter Gemini models.',
      freeNoAttach: 'Image and file attachments are not available on the Free plan. Subscribe to Omni AI (Base/Plus/Pro) to use them.',
      subscribeBtn: 'Subscribe to Omni AI', needsSub: 'Requires an Omni AI subscription', freeTextOnly: 'Text only',
      subscribeToUpgrade: 'Subscribe to Omni AI to upgrade', baseDisabled: 'Not available right now', tapToUpgrade: 'Tap to upgrade',
      neuronsLeft: '{n} / {c} neurons left today', resetsIn: 'resets in {t}',
      warn80: 'You have used most of today\'s AI limit. A One-day Boost can keep you going.',
      boostTitle: 'One-day Boost', boostHint: 'Out of daily neurons? Add more for today only — it disappears at midnight. Does not change your monthly credits.',
      boostToday: 'Boosts bought today', boostBtn: 'Buy Boost', boostAdminText: 'Enter an admin password to buy a Boost (+{neurons} neurons, today only) for {cost} Omni Tokens.',
      boostChip: 'Buy One-day Boost',
      boostLate: 'Only about {t} is left today. A Boost expires at midnight, so you will get very little use out of it.',
      boostLateConfirm: 'Buy anyway',
      boostCutoffNote: 'Boosts cannot be bought this close to midnight. You can buy one after midnight.'
    },
    tl: {
      upgradeBtn: 'I-upgrade ang AI plan', today: 'ngayon', pillTitle: 'I-tap para makita ang Omni AI plans',
      title: 'Omni AI Plans', loading: 'Kinukuha ang plans...', loadError: 'Hindi makuha ang plans ngayon. Subukan muli mamaya.',
      current: 'Kasalukuyang plan', none: 'Base (kasama sa subscription mo)', inclSub: 'Kasama sa subscription', perMonth: 'credits / buwan', perDay: 'neurons / araw', neurons: 'neurons', unlimited: 'Walang limit',
      tokens: 'Omni Tokens', upgradeFor: 'I-upgrade sa halagang', balance: 'Balanse mo', buy: 'Piliin', owned: 'Aktibo', validUntil: 'Valid hanggang',
      free: 'Libre', noPlans: 'Walang available na upgrade plan ngayon.', adminPwTitle: 'Pahintulot ng Admin', adminPwText: 'Ilagay ang admin password para bilhin ang {name} plan sa halagang {cost} Omni Tokens.',
      adminPwPlaceholder: 'Admin password', confirm: 'Bilhin', cancel: 'Kanselahin', buying: 'Ina-activate...', close: 'Isara',
      successTitle: 'Na-activate ang plan', failTitle: 'Hindi ma-activate ang plan', insufficient: 'Kulang ang Omni Tokens. Bumili muna ng tokens.',
      modelTitle: 'AI model', modelHint: 'Piliin kung anong model ang sasagot sa mga tanong mo. Standard ang default.', modelDefault: 'Standard', modelDefaultDesc: 'Default na model',
      modelSelected: 'Napili', modelUse: 'Gamitin', modelRequires: 'Kailangan ang {tier} plan', modelUnavailable: 'Hindi available ngayon',
      modelDescFlashLite: 'Mabilis at magaan', modelDescFlash: 'Mas matalino, para sa mas mahirap na tanong', modelDescPro: 'Pinakamalakas, para sa pinakamahirap na tanong',
      modelBtnTitle: 'AI model at plan', upgradeShort: 'I-upgrade', modelLoading: 'Kinukuha...',
      freeName: 'Libre', freeNone: 'Libre', freeNote: 'Free plan: text na tanong lang (walang attach na larawan/file o pagpili ng model). Mag-subscribe sa Omni AI para sa Base, Plus at Pro na may mas matatalinong Gemini model.',
      freeNoAttach: 'Hindi available ang pag-attach ng larawan/file sa Free plan. Mag-subscribe sa Omni AI (Base/Plus/Pro) para magamit ito.',
      subscribeBtn: 'Mag-subscribe sa Omni AI', needsSub: 'Kailangan ng Omni AI subscription', freeTextOnly: 'Text lang',
      subscribeToUpgrade: 'Mag-subscribe sa Omni AI para mag-upgrade', baseDisabled: 'Hindi available ngayon', tapToUpgrade: 'I-tap para mag-upgrade',
      neuronsLeft: '{n} / {c} neurons na lang ngayon', resetsIn: 'magre-reset sa {t}',
      warn80: 'Halos ubos na ang AI limit mo ngayong araw. Puwede kang bumili ng One-day Boost para makapagpatuloy.',
      boostTitle: 'One-day Boost', boostHint: 'Ubos na ang daily neurons? Dagdagan para sa ngayong araw lang — mawawala ito sa hatinggabi. Hindi nito ginagalaw ang monthly credits.',
      boostToday: 'Nabiling Boost ngayon', boostBtn: 'Bilhin ang Boost', boostAdminText: 'Maglagay ng admin password para bilhin ang Boost (+{neurons} neurons, ngayong araw lang) sa halagang {cost} Omni Tokens.',
      boostChip: 'Bumili ng One-day Boost',
      boostLate: 'Mga {t} na lang ang natitira ngayong araw. Mawawala ang Boost sa hatinggabi, kaya kaunti na lang ang magagamit mo.',
      boostLateConfirm: 'Bilhin pa rin',
      boostCutoffNote: 'Hindi na puwedeng bumili ng Boost malapit na ang hatinggabi. Puwede kang bumili pagkatapos ng hatinggabi.'
    }
  };
  function planStrings() { return PLAN_STRINGS[currentLang() === 'tl' ? 'tl' : 'en']; }
  // Napiling AI model (Gemini Flash / Flash-Lite). '' = Standard (default ng RELAY). Ang RELAY ang nagpapatupad ng tier/availability.
  const AI_MODEL_CHOICE_KEY = 'omnipos_ai_model_choice';
  function getAiModelChoice() {
    try {
      const v = localStorage.getItem(AI_MODEL_CHOICE_KEY);
      return (typeof v === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(v)) ? v : '';
    } catch (e) { return ''; }
  }
  function setAiModelChoice(v) {
    try {
      if (typeof v === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(v)) localStorage.setItem(AI_MODEL_CHOICE_KEY, v);
      else localStorage.removeItem(AI_MODEL_CHOICE_KEY);
    } catch (e) {}
  }
  // ---- Model / upgrade selector sa composer (Claude-style) -------------------------------
  // Mobile: icon button lang (upgrade icon). Desktop: pill na may pangalan ng napiling model.
  // Pindutin = sheet na may listahan ng model (check = napili) at "Upgrade" na bumubukas sa plans.
  // Lahat ng datos (model, tier, lock) ay galing sa RELAY (/ai-assistant/plans); walang naka-hardcode.
  const MODEL_OFFER_TTL_MS = 90000;
  let aiModelOfferCache = { at: 0, data: null };
  let aiModelOfferLoading = null;
  function invalidateAiModelOffer() { aiModelOfferCache.at = 0; }
  function loadAiModelOffer(force) {
    if (!force && aiModelOfferCache.data && Date.now() - aiModelOfferCache.at < MODEL_OFFER_TTL_MS) return Promise.resolve(aiModelOfferCache.data);
    if (aiModelOfferLoading) return aiModelOfferLoading;
    aiModelOfferLoading = (async () => {
      try {
        const res = await authFetch(`${API_URL}/ai-assistant/plans`, { timeoutMs: 15000 });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.success) { aiModelOfferCache = { at: Date.now(), data }; return data; }
      } catch (e) {}
      return null;
    })().then((d) => { aiModelOfferLoading = null; return d; });
    return aiModelOfferLoading;
  }
  function shortModelName(name) { return String(name || '').replace(/^gemini\s+/i, '').trim(); }
  // Pangalan ng napiling model (o ng plan kung walang model na mapipili) para sa desktop pill.
  function currentModelLabel(data) {
    const ps = planStrings();
    const am = data && data.aiModels;
    if (am && am.enabled && Array.isArray(am.options) && am.options.length) {
      const choice = getAiModelChoice();
      const opt = am.options.find((o) => o.key === choice);
      if (opt && !opt.locked && !opt.unavailable) return shortModelName(opt.name);
      return ps.modelDefault;
    }
    return (data && data.currentTier && data.currentTier.name) || ps.upgradeShort;
  }
  // The composer button shows for every user who can chat with Omni AI: subscribers get the model/plan sheet,
  // Free-plan users get an "Upgrade" button that opens the Omni AI Plans window.
  function modelBtnAllowed() { return aiChatEnabled() && effectiveAiMode() === 'ai'; }
  async function syncAiModelButton(force) {
    const btn = document.getElementById('faq-model-btn');
    if (!btn) return;
    if (!modelBtnAllowed()) { btn.hidden = true; closeAiModelSheet(); return; }
    const ps = planStrings();
    btn.hidden = false;
    if (!btn.dataset.modelReady) {
      btn.dataset.modelReady = '1';
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); toggleAiModelSheet(); });
    }
    const label = document.getElementById('faq-model-label');
    // Free plan (no Omni AI subscription): no model to choose, so the button is a plain "Upgrade" shortcut to the plans window.
    if (!aiAssistantUnlocked()) {
      btn.dataset.freePlan = '1';
      btn.title = ps.upgradeBtn;
      btn.setAttribute('aria-label', ps.upgradeBtn);
      btn.removeAttribute('aria-haspopup');
      closeAiModelSheet();
      if (label) label.textContent = ps.upgradeShort;
      return;
    }
    if (btn.dataset.freePlan === '1') {
      delete btn.dataset.freePlan;
      btn.setAttribute('aria-haspopup', 'dialog');
      if (label) label.textContent = ps.modelDefault;
    }
    btn.title = ps.modelBtnTitle;
    btn.setAttribute('aria-label', ps.modelBtnTitle);
    if (label && !label.textContent) label.textContent = ps.modelDefault;
    const data = await loadAiModelOffer(!!force);
    if (!data) return;
    // Kung naka-lock/hindi na available ang napiling model, bumalik sa Standard.
    const am = data.aiModels;
    const choice = getAiModelChoice();
    if (choice) {
      const opt = am && Array.isArray(am.options) ? am.options.find((o) => o.key === choice) : null;
      if (!opt || opt.locked || opt.unavailable) setAiModelChoice('');
    }
    if (!modelBtnAllowed()) { btn.hidden = true; return; }
    if (label) label.textContent = currentModelLabel(data);
  }
  function closeAiModelSheet() {
    const sheet = document.getElementById('faq-model-sheet');
    if (sheet) sheet.remove();
    const btn = document.getElementById('faq-model-btn');
    if (btn) { btn.classList.remove('is-active'); btn.setAttribute('aria-expanded', 'false'); }
    document.removeEventListener('keydown', onModelSheetKey, true);
    window.removeEventListener('resize', onModelSheetResize);
  }
  // Isara lang kapag nagbago ang LAPAD (rotate/resize). Ang pagbabago ng taas (keyboard, address bar sa mobile) ay hindi dapat magsara.
  let modelSheetWidth = 0;
  function onModelSheetResize() {
    if (window.innerWidth !== modelSheetWidth) closeAiModelSheet();
    else { const p = document.querySelector('#faq-model-sheet .faq-model-sheet-panel'); if (p) { positionAiModelSheet(p); fitAiModelScroller(p); } }
  }
  function onModelSheetKey(ev) { if (ev.key === 'Escape') closeAiModelSheet(); }
  function toggleAiModelSheet() {
    // Free plan: the button is "Upgrade" — go straight to the Omni AI Plans window.
    if (!aiAssistantUnlocked()) { closeAiModelSheet(); openAiPlansModal(); return; }
    if (document.getElementById('faq-model-sheet')) { closeAiModelSheet(); return; }
    openAiModelSheet();
  }
  function positionAiModelSheet(panel) {
    const btn = document.getElementById('faq-model-btn');
    if (!btn || !panel) return;
    if (window.innerWidth <= 768) { panel.style.left = ''; panel.style.top = ''; panel.style.bottom = ''; return; }
    const r = btn.getBoundingClientRect();
    const w = panel.offsetWidth || 280;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
    panel.style.left = left + 'px';
    panel.style.bottom = Math.max(8, window.innerHeight - r.top + 8) + 'px';
    panel.style.top = 'auto';
  }
  // Description under a model name, based on its family (lite / flash / pro). Older RELAY builds only send the key.
  function modelDescFor(o, ps) {
    const fam = o.family || (o.key === 'flash' ? 'flash' : (o.key === 'flashLite' ? 'lite' : ''));
    if (fam === 'lite') return ps.modelDescFlashLite;
    if (fam === 'flash') return ps.modelDescFlash;
    if (fam === 'pro') return ps.modelDescPro;
    return '';
  }
  // Show exactly 3 models (plus the Standard row) at once; when there are more, the list scrolls and a bit of the next row peeks out.
  const MODEL_SHEET_VISIBLE_MODELS = 3;
  function fitAiModelScroller(panel) {
    const sc = panel && panel.querySelector('.faq-model-scroll');
    if (!sc) return;
    sc.style.maxHeight = '';
    sc.classList.remove('is-scrollable');
    const rows = sc.querySelectorAll('.faq-model-row');
    const visibleRows = MODEL_SHEET_VISIBLE_MODELS + 1; // Standard + 3 models
    if (rows.length <= visibleRows) return;
    const first = rows[0], next = rows[visibleRows];
    const h = next.offsetTop - first.offsetTop + Math.round(next.offsetHeight * 0.4);
    if (h > 0) { sc.style.maxHeight = h + 'px'; sc.classList.add('is-scrollable'); }
  }
  function renderAiModelSheetRows(panel, data) {
    const ps = planStrings();
    const modelRows = [];
    const tailRows = [];
    const mk = (cls, name, desc, side, attrs) => `<button type="button" class="faq-model-row ${cls}" ${attrs}><span><span class="faq-model-name">${name}</span>${desc ? `<span class="faq-model-desc">${escapeHtml(desc)}</span>` : ''}</span><span class="faq-model-side">${side}</span></button>`;
    const am = data && data.aiModels;
    if (am && am.enabled && Array.isArray(am.options) && am.options.length) {
      const choice = getAiModelChoice();
      const check = '<i class="fa-solid fa-check faq-model-check"></i>';
      // Standard first, then the models in the order RELAY sends them (lowest version -> highest version).
      modelRows.push(mk('', escapeHtml(ps.modelDefault), ps.modelDefaultDesc, choice === '' ? check : '', 'data-model="" data-usable="1"'));
      am.options.forEach((o) => {
        const locked = !!o.locked, unavailable = !!o.unavailable;
        const side = locked ? `<i class="fa-solid fa-lock"></i> ${escapeHtml(o.requiredTierName || '')}`
          : (unavailable ? escapeHtml(ps.modelUnavailable) : (choice === o.key ? check : ''));
        modelRows.push(mk(locked ? 'is-locked' : (unavailable ? 'is-unavailable' : ''), escapeHtml(shortModelName(o.name)), modelDescFor(o, ps), side,
          `data-model="${escapeHtml(o.key)}" data-usable="${locked || unavailable ? '0' : '1'}" data-locked="${locked ? '1' : '0'}"`));
      });
      tailRows.push('<div class="faq-model-sep"></div>');
    }
    const tierName = data && data.currentTier && data.currentTier.name ? data.currentTier.name : (data ? ps.none : '');
    tailRows.push(mk('faq-model-upgrade', `<i class="fa-solid fa-arrow-up-right-dots"></i> ${escapeHtml(ps.upgradeShort)}`, '', escapeHtml(tierName), 'data-upgrade="1"'));
    const list = panel.querySelector('.faq-model-list');
    list.innerHTML = (modelRows.length ? `<div class="faq-model-scroll">${modelRows.join('')}</div>` : '') + tailRows.join('');
    panel.querySelectorAll('.faq-model-row').forEach((row) => {
      row.addEventListener('click', () => {
        if (row.dataset.upgrade === '1' || row.dataset.locked === '1') { closeAiModelSheet(); openAiPlansModal(); return; }
        if (row.dataset.usable !== '1') return;
        setAiModelChoice(row.dataset.model || '');
        const label = document.getElementById('faq-model-label');
        if (label) label.textContent = currentModelLabel(data);
        closeAiModelSheet();
      });
    });
    positionAiModelSheet(panel);
    fitAiModelScroller(panel);
    // Keep the currently selected model in view when it sits below the first visible rows.
    const sc = list.querySelector('.faq-model-scroll.is-scrollable');
    const sel = sc && sc.querySelector('.faq-model-check') ? sc.querySelector('.faq-model-check').closest('.faq-model-row') : null;
    if (sc && sel) {
      const bottom = sel.offsetTop - sc.querySelector('.faq-model-row').offsetTop + sel.offsetHeight;
      if (bottom > sc.clientHeight) sc.scrollTop = Math.max(0, sel.offsetTop - sc.querySelector('.faq-model-row').offsetTop - 8);
    }
  }
  function openAiModelSheet() {
    if (!modelBtnAllowed()) return;
    const btn = document.getElementById('faq-model-btn');
    const ps = planStrings();
    const sheet = document.createElement('div');
    sheet.id = 'faq-model-sheet';
    sheet.className = 'faq-model-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', ps.modelBtnTitle);
    sheet.innerHTML = `<div class="faq-model-sheet-backdrop"></div><div class="faq-model-sheet-panel"><div class="faq-model-sheet-handle"></div><div class="faq-model-list"></div></div>`;
    document.body.appendChild(sheet);
    const panel = sheet.querySelector('.faq-model-sheet-panel');
    sheet.querySelector('.faq-model-sheet-backdrop').addEventListener('click', closeAiModelSheet);
    document.addEventListener('keydown', onModelSheetKey, true);
    modelSheetWidth = window.innerWidth;
    window.addEventListener('resize', onModelSheetResize);
    if (btn) { btn.classList.add('is-active'); btn.setAttribute('aria-expanded', 'true'); }
    const cached = aiModelOfferCache.data;
    if (cached) {
      renderAiModelSheetRows(panel, cached);
    } else {
      panel.querySelector('.faq-model-list').innerHTML = `<div class="faq-model-row" style="cursor:default;"><span class="faq-model-name">${escapeHtml(ps.modelLoading)}</span></div>`;
      positionAiModelSheet(panel);
    }
    // Laging subukang kumuha ng sariwang datos; i-update ang sheet kung nakabukas pa rin.
    loadAiModelOffer(true).then((data) => {
      if (!document.getElementById('faq-model-sheet')) return;
      if (data) { renderAiModelSheetRows(panel, data); const label = document.getElementById('faq-model-label'); if (label) label.textContent = currentModelLabel(data); }
      else if (!cached) renderAiModelSheetRows(panel, null);
    });
  }
  // Compact na neurons: 4500 -> 4.5k, 19000 -> 19k, 1250000 -> 1.25M (iisang format sa pill, plans, boost at extra).
  function fmtNeurons(n) {
    const v = Math.max(0, Number(n) || 0);
    const trim = (x, d) => String(Number(x.toFixed(d)));
    if (v >= 999500) return trim(v / 1000000, 2) + 'M';
    if (v >= 1000) return trim(v / 1000, 1) + 'k';
    return String(Math.round(v));
  }
  const EXTRA_STRINGS = {
    en: { title: 'Extra credits', hint: 'Cheaper than upgrading: adds credits and daily limit, valid until the end of this month.', credits: 'credits', left: 'left this month', buy: 'Buy',
          adminPwText: 'Enter an admin password to buy {name} ({credits} credits) for {cost} Omni Tokens.', bought: 'Bought this month', perCredit: 'token/credit' },
    tl: { title: 'Extra credits', hint: 'Mas tipid kaysa mag-upgrade: dagdag credits at daily limit, valid hanggang katapusan ng buwan.', credits: 'credits', left: 'natitira ngayong buwan', buy: 'Bilhin',
          adminPwText: 'Maglagay ng admin password para bilhin ang {name} ({credits} credits) sa halagang {cost} Omni Tokens.', bought: 'Nabili ngayong buwan', perCredit: 'token/credit' }
  };
  function extraStrings() { return EXTRA_STRINGS[currentLang() === 'tl' ? 'tl' : 'en']; }
  async function openAiPlansModal() {
    const ps = planStrings();
    const swal = window.Swal && typeof window.Swal.fire === 'function' ? window.Swal : null;
    if (!swal) { alert(ps.loadError); return; }
    swal.fire({ title: ps.title, html: `<div style="padding:12px 0;">${escapeHtml(ps.loading)}</div>`, showConfirmButton: false, showCloseButton: true, width: 560 });
    let data = null;
    try {
      const res = await authFetch(`${API_URL}/ai-assistant/plans`, { timeoutMs: 15000 });
      data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success) data = null;
    } catch (e) { data = null; }
    if (!data) {
      swal.fire({ title: ps.title, html: `<div style="padding:8px 0;">${escapeHtml(ps.loadError)}</div>`, confirmButtonText: ps.close, width: 560 });
      return;
    }
    const cap = (n) => n === 0 ? ps.unlimited : fmtNeurons(n);
    const validUntil = data.validUntil ? new Date(data.validUntil).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    // Base = pinakamababang tier (libre, default) — ipinapakita lang, hindi mabibili.
    // Base switched OFF in RELAY: hide the card completely (only kept visible if the device is currently ON Base,
    // so an existing Base subscriber still sees their own active plan).
    const baseHidden = !!(data.baseTier && data.baseTier.disabled && !data.baseTier.isCurrent);
    const allPlans = (data.freeTier ? [data.freeTier] : []).concat(data.baseTier && !baseHidden ? [data.baseTier] : [], data.plans || []);
    const cards = allPlans.map((p) => {
      // Whole card is clickable when it leads somewhere: subscribe (Free/no subscription) or buy/upgrade (subscribed).
      // Base switched OFF in RELAY (p.disabled) is shown greyed out and is not clickable.
      const baseOff = !!(p.isBase && p.disabled);
      let act = '';
      let action = '';
      if (p.isCurrent) {
        action = `<span style="font-weight:700;color:#16a34a;"><i class="fa-solid fa-circle-check"></i> ${escapeHtml(ps.owned)}</span>`;
      } else if (baseOff) {
        action = `<span style="font-size:.85rem;font-weight:700;opacity:.75;"><i class="fa-solid fa-ban"></i> ${escapeHtml(ps.baseDisabled)}</span>`;
      } else if (p.needsSubscription && p.isBase) {
        act = 'subscribe';
        action = `<button type="button" class="faq-plan-sub-btn" style="cursor:pointer;border:none;border-radius:8px;padding:8px 14px;font-weight:700;background:#2563eb;color:#fff;">${escapeHtml(ps.subscribeBtn)}</button>`;
      } else if (p.needsSubscription) {
        act = 'subscribe';
        action = `<span style="font-size:.85rem;font-weight:700;color:#2563eb;"><i class="fa-solid fa-arrow-up-right-dots"></i> ${escapeHtml(ps.subscribeToUpgrade)}</span>`;
      } else if (p.canPurchase) {
        act = 'buy';
        action = `<button type="button" class="faq-plan-buy-btn" style="cursor:pointer;border:none;border-radius:8px;padding:8px 14px;font-weight:700;background:#2563eb;color:#fff;">${escapeHtml(data.currentTier ? ps.upgradeFor : ps.buy)} ${p.costTokens} ${escapeHtml(ps.tokens)}</button>`;
      } else if (p.locked) {
        action = `<span style="font-size:.85rem;font-weight:700;color:#dc2626;"><i class="fa-solid fa-lock"></i> ${escapeHtml(p.lockedReason || '')}</span>`;
      }
      const clickAttrs = act
        ? ` class="faq-plan-card" data-act="${act}" data-tier="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" data-cost="${Number(p.costTokens) || 0}" role="button" tabindex="0"`
        : '';
      const cardStyle = `border:1px solid rgba(128,128,128,.35);border-radius:12px;padding:12px 14px;margin:8px 0;text-align:left;${p.isCurrent ? 'outline:2px solid #16a34a;' : ''}${act ? 'cursor:pointer;' : ''}${baseOff ? 'opacity:.55;' : ''}`;
      return `<div${clickAttrs} style="${cardStyle}">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;">
          <strong style="font-size:1.05rem;">${escapeHtml(p.name)}</strong>
          <span style="font-weight:700;">${p.isFree ? escapeHtml(ps.free) : (p.isBase ? escapeHtml(ps.inclSub) : `${p.priceTokens} ${escapeHtml(ps.tokens)}`)}</span>
        </div>
        <div style="font-size:.85rem;opacity:.85;margin:4px 0 8px;">${p.monthlyCredits} ${escapeHtml(ps.perMonth)} · ${escapeHtml(cap(p.dailyCap))} ${escapeHtml(ps.perDay)}${p.textOnly ? ` · ${escapeHtml(ps.freeTextOnly)}` : ''}</div>
        <div>${action}</div>
      </div>`;
    }).join('') || `<div style="padding:8px 0;">${escapeHtml(ps.noPlans)}</div>`;
    const cur = data.isFree
      ? `${escapeHtml(ps.current)}: <strong>${escapeHtml(ps.freeName)}</strong><div style="margin-top:4px;opacity:.85;">${escapeHtml(ps.freeNote)}</div>`
      : (data.currentTier ? `${escapeHtml(ps.current)}: <strong>${escapeHtml(data.currentTier.name)}</strong>` : `${escapeHtml(ps.current)}: ${escapeHtml(ps.none)}`);
    const bal = typeof data.balanceTokens === 'number' ? ` · ${escapeHtml(ps.balance)}: <strong>${data.balanceTokens}</strong> ${escapeHtml(ps.tokens)}` : '';
    const es = extraStrings();
    const ex = data.extraCredits;
    const extraHtml = (ex && ex.enabled && Array.isArray(ex.packs) && ex.packs.length) ? `<div style="margin-top:14px;text-align:left;">
        <strong style="font-size:1.02rem;">${escapeHtml(es.title)}</strong>
        <div style="font-size:.8rem;opacity:.8;margin:2px 0 6px;">${escapeHtml(es.hint)}${ex.available !== null && ex.available !== undefined ? ` · ${ex.available} ${escapeHtml(es.left)}` : ''}${ex.purchasedCredits ? ` · ${escapeHtml(es.bought)}: ${ex.purchasedCredits}` : ''}</div>
        ${ex.packs.map((k) => `<div style="border:1px solid rgba(128,128,128,.35);border-radius:12px;padding:10px 14px;margin:6px 0;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div><strong>${escapeHtml(k.name)}</strong><div style="font-size:.8rem;opacity:.8;">${k.credits} ${escapeHtml(es.credits)}${k.dailyBonus ? ` · +${fmtNeurons(k.dailyBonus)} ${escapeHtml(ps.perDay)}` : ''} · ${k.pricePerCredit} ${escapeHtml(es.perCredit)}</div></div>
          <div style="display:flex;align-items:center;gap:8px;"><span style="font-weight:700;">${k.priceTokens} ${escapeHtml(ps.tokens)}</span>
          ${k.canPurchase ? `<button type="button" class="faq-extra-buy-btn" data-pack="${escapeHtml(k.id)}" data-name="${escapeHtml(k.name)}" data-cost="${k.priceTokens}" data-credits="${k.credits}" style="cursor:pointer;border:none;border-radius:8px;padding:8px 14px;font-weight:700;background:#2563eb;color:#fff;">${escapeHtml(es.buy)}</button>` : `<span style="font-size:.8rem;color:#dc2626;max-width:180px;">${escapeHtml(k.unavailableReason || '')}</span>`}</div>
        </div>`).join('')}
      </div>` : '';
    const bo = data.dayBoost;
    const boostHtml = (bo && bo.enabled && Array.isArray(bo.options) && (bo.options.some((o) => o && o.canPurchase) || bo.cutoffBlocked)) ? `<div id="faq-boost-section" style="margin-top:14px;text-align:left;">
        <strong style="font-size:1.02rem;"><i class="fa-solid fa-bolt"></i> ${escapeHtml(ps.boostTitle)}</strong>
        <div style="font-size:.8rem;opacity:.8;margin:2px 0 6px;">${escapeHtml(ps.boostHint)}${bo.boughtToday ? ` · ${escapeHtml(ps.boostToday)}: ${bo.boughtToday}/${bo.maxPerDay}` : ''}</div>
        ${bo.cutoffBlocked ? `<div style="font-size:.82rem;margin:4px 0 6px;color:#dc2626;font-weight:600;">${escapeHtml(ps.boostCutoffNote)}</div>` : (bo.lateWarning && typeof bo.minutesLeft === 'number' ? `<div style="font-size:.82rem;margin:4px 0 6px;color:#b45309;font-weight:600;">⚠️ ${escapeHtml(ps.boostLate.replace('{t}', fmtBoostMinutes(bo.minutesLeft)))}</div>` : '')}
        ${bo.options.map((o) => `<div style="border:1px solid rgba(128,128,128,.35);border-radius:12px;padding:10px 14px;margin:6px 0;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div><strong>+${fmtNeurons(o.neurons)} ${escapeHtml(ps.neurons)}</strong><div style="font-size:.8rem;opacity:.8;">${o.unavailableReason ? ` <span style="color:#dc2626;">${escapeHtml(o.unavailableReason)}</span>` : ''}</div></div>
          <div style="display:flex;align-items:center;gap:8px;"><span style="font-weight:700;">${o.priceTokens} ${escapeHtml(ps.tokens)}</span>
          ${o.canPurchase ? `<button type="button" class="faq-boost-buy-btn" data-boost="${escapeHtml(o.id)}" data-neurons="${o.neurons}" data-cost="${o.priceTokens}" style="cursor:pointer;border:none;border-radius:8px;padding:8px 14px;font-weight:700;background:#2563eb;color:#fff;">${escapeHtml(ps.boostBtn)}</button>` : ''}</div>
        </div>`).join('')}
      </div>` : '';
    // Ang pagpili ng AI model ay nasa button sa composer (faq-model-btn), hindi na rito.
    aiModelOfferCache = { at: Date.now(), data };
    const html = `<div style="font-size:.85rem;opacity:.9;margin-bottom:6px;">${cur}${bal}${validUntil ? `<br>${escapeHtml(ps.validUntil)} ${escapeHtml(validUntil)}` : ''}</div>${cards}${boostHtml}${extraHtml}`;
    swal.fire({
      title: ps.title, html, showConfirmButton: false, showCloseButton: true, width: 560,
      didOpen: (popup) => {
        popup.querySelectorAll('.faq-plan-card').forEach((card) => {
          const run = () => {
            if (card.dataset.act === 'subscribe') {
              swal.close();
              if (typeof guardPremiumFeature === 'function') guardPremiumFeature('ai_assistant');
            } else if (card.dataset.act === 'buy') {
              buyAiPlan(card.dataset.tier, card.dataset.name, card.dataset.cost);
            }
          };
          card.addEventListener('click', run);
          card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); run(); } });
        });
        popup.querySelectorAll('.faq-extra-buy-btn').forEach((btn) => {
          btn.addEventListener('click', () => buyExtraCredits(btn.dataset.pack, btn.dataset.name, btn.dataset.cost, btn.dataset.credits));
        });
        popup.querySelectorAll('.faq-boost-buy-btn').forEach((btn) => {
          btn.addEventListener('click', () => buyDayBoost(btn.dataset.boost, btn.dataset.neurons, btn.dataset.cost));
        });
        // Galing sa "daily limit reached" na button: dumiretso sa Boost section.
        if (openAiPlansModal._scrollBoost) {
          openAiPlansModal._scrollBoost = false;
          setTimeout(() => popup.querySelector('#faq-boost-section')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
        }
      }
    });
  }
  async function buyAiPlan(tierId, name, cost) {
    const ps = planStrings();
    const swal = window.Swal;
    const pw = await swal.fire({
      title: ps.adminPwTitle,
      text: ps.adminPwText.replace('{name}', name).replace('{cost}', cost),
      input: 'password', inputPlaceholder: ps.adminPwPlaceholder,
      showCancelButton: true, confirmButtonText: ps.confirm, cancelButtonText: ps.cancel,
      inputValidator: (v) => (!v ? ps.adminPwPlaceholder : undefined)
    });
    if (!pw.isConfirmed) { openAiPlansModal(); return; }
    swal.fire({ title: ps.buying, allowOutsideClick: false, showConfirmButton: false, didOpen: () => swal.showLoading() });
    let data = null; let status = 0;
    try {
      const res = await authFetch(`${API_URL}/ai-assistant/plans/purchase`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierId, adminPassword: pw.value }), timeoutMs: 30000
      });
      status = res.status;
      data = await res.json().catch(() => null);
    } catch (e) { data = null; }
    if (data && data.success) {
      invalidateAiModelOffer();
      if (data.credits) refreshAiCreditPill(data.credits); else refreshAiCreditPill();
      await swal.fire({ icon: 'success', title: ps.successTitle, text: data.message || '', confirmButtonText: ps.close });
      return;
    }
    const msg = (data && data.message) || (status === 402 ? ps.insufficient : ps.loadError);
    await swal.fire({ icon: 'error', title: ps.failTitle, text: msg, confirmButtonText: ps.close });
    openAiPlansModal();
  }

  // Natitirang minuto bago ang hatinggabi (oras ng RELAY), ayon sa offer na natanggap. null kung walang impormasyon.
  function boostMinutesLeftNow() {
    const bo = aiModelOfferCache && aiModelOfferCache.data && aiModelOfferCache.data.dayBoost;
    if (!bo || typeof bo.resetsInMs !== 'number' || !aiModelOfferCache.at) return null;
    return Math.max(0, Math.ceil((bo.resetsInMs - (Date.now() - aiModelOfferCache.at)) / 60000));
  }
  function fmtBoostMinutes(mins) {
    const m = Math.max(0, Math.round(Number(mins) || 0));
    const h = Math.floor(m / 60), r = m % 60;
    return h > 0 ? (r > 0 ? `${h}h ${r}m` : `${h}h`) : `${m}m`;
  }
  async function buyDayBoost(boostId, neurons, cost) {
    const ps = planStrings();
    const swal = window.Swal;
    // Babala lang (hindi hinaharang): malapit na ang hatinggabi kaya kaunti na lang ang magagamit. Ang RELAY ang nagpapasya kung may cutoff.
    const bo0 = aiModelOfferCache && aiModelOfferCache.data && aiModelOfferCache.data.dayBoost;
    const minsLeft = boostMinutesLeftNow();
    const lateText = (bo0 && bo0.lateWarning && minsLeft !== null) ? ' ⚠️ ' + ps.boostLate.replace('{t}', fmtBoostMinutes(minsLeft)) : '';
    const pw = await swal.fire({
      title: ps.adminPwTitle,
      text: ps.boostAdminText.replace('{neurons}', fmtNeurons(neurons)).replace('{cost}', cost) + lateText,
      input: 'password', inputPlaceholder: ps.adminPwPlaceholder,
      showCancelButton: true, confirmButtonText: lateText ? ps.boostLateConfirm : ps.confirm, cancelButtonText: ps.cancel,
      inputValidator: (v) => (!v ? ps.adminPwPlaceholder : undefined)
    });
    if (!pw.isConfirmed) { openAiPlansModal(); return; }
    swal.fire({ title: ps.buying, allowOutsideClick: false, showConfirmButton: false, didOpen: () => swal.showLoading() });
    let data = null; let status = 0;
    try {
      const res = await authFetch(`${API_URL}/ai-assistant/day-boost/purchase`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boostId, adminPassword: pw.value }), timeoutMs: 30000
      });
      status = res.status;
      data = await res.json().catch(() => null);
    } catch (e) { data = null; }
    if (data && data.success) {
      invalidateAiModelOffer();
      if (data.credits) refreshAiCreditPill(data.credits); else refreshAiCreditPill();
      await swal.fire({ icon: 'success', title: ps.successTitle, text: data.message || '', confirmButtonText: ps.close });
      return;
    }
    const msg = (data && data.message) || (status === 402 ? ps.insufficient : ps.loadError);
    await swal.fire({ icon: 'error', title: ps.failTitle, text: msg, confirmButtonText: ps.close });
    openAiPlansModal();
  }

  async function buyExtraCredits(packId, name, cost, credits) {
    const ps = planStrings();
    const es = extraStrings();
    const swal = window.Swal;
    const pw = await swal.fire({
      title: ps.adminPwTitle,
      text: es.adminPwText.replace('{name}', name).replace('{credits}', credits).replace('{cost}', cost),
      input: 'password', inputPlaceholder: ps.adminPwPlaceholder,
      showCancelButton: true, confirmButtonText: ps.confirm, cancelButtonText: ps.cancel,
      inputValidator: (v) => (!v ? ps.adminPwPlaceholder : undefined)
    });
    if (!pw.isConfirmed) { openAiPlansModal(); return; }
    swal.fire({ title: ps.buying, allowOutsideClick: false, showConfirmButton: false, didOpen: () => swal.showLoading() });
    let data = null; let status = 0;
    try {
      const res = await authFetch(`${API_URL}/ai-assistant/extra-credits/purchase`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId, adminPassword: pw.value }), timeoutMs: 30000
      });
      status = res.status;
      data = await res.json().catch(() => null);
    } catch (e) { data = null; }
    if (data && data.success) {
      invalidateAiModelOffer();
      if (data.credits) refreshAiCreditPill(data.credits); else refreshAiCreditPill();
      await swal.fire({ icon: 'success', title: ps.successTitle, text: data.message || '', confirmButtonText: ps.close });
      return;
    }
    const msg = (data && data.message) || (status === 402 ? ps.insufficient : ps.loadError);
    await swal.fire({ icon: 'error', title: ps.failTitle, text: msg, confirmButtonText: ps.close });
    openAiPlansModal();
  }

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
      // Support desk closed (RELAY-controlled): the ticket is saved locally and sent later.
      const successText = (data.supportDeskOpen === false) ? s.ticketSuccessQueued : s.ticketSuccess;
      if (window.Swal && typeof window.Swal.fire === 'function') {
        window.Swal.fire({ icon: 'success', title: successText, timer: data.supportDeskOpen === false ? 4200 : 2200, showConfirmButton: false });
      } else {
        alert(successText);
      }
    } catch (e) {
      alert(s.ticketError);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (submitText) submitText.textContent = originalLabel;
    }
  }

  // BAGO: OmniPOS logo (yung "O" na may dot, kapareho ng app icon sa home
  // screen) bilang icon ng Omni AI — kapalit ng lahat ng robot icon.
  // Inline SVG na gumagamit ng currentColor kaya sumusunod sa kulay ng
  // badge/button. Kapag spin=true, ginagamit ang built-in na "fa-spin"
  // keyframes ng Font Awesome (walang kailangang baguhin sa CSS).
  function omniLogoIcon(size, spin) {
    return '<svg viewBox="108 108 296 296" width="' + size + '" height="' + size + '" fill="none" aria-hidden="true" style="vertical-align:-0.2em;' +
      (spin ? 'animation:fa-spin 1.1s linear infinite;' : '') +
      '"><path d="M274.2 373.5A119.5 119.5 0 1 1 374.1 270.1" stroke="currentColor" stroke-width="48" stroke-linecap="round"/><circle cx="340.3" cy="340.3" r="26" fill="currentColor"/></svg>';
  }

  async function askAIAssistantChat(query, thread) {
    const lang = currentLang();
    const s = STRINGS();
    lastAiFailure = null;

    const loadingBubble = appendAssistantBubble(thread, `
      <div class="faq-ai-badge faq-ai-thinking">${omniLogoIcon('1.15em', true)} ${s.aiThinking}</div>`);
    // BAGO: dito na mismo isinasagawa ang scroll papunta sa BAGONG
    // bubble (hindi na hinihintay matapos mag-type-out ang buong sagot)
    // — ang SIMULA/head ng bubble na ito (parehong sa "thinking" state
    // at sa habang tina-type-out ang sagot, dahil iisa lang itong
    // element sa buong proseso) ang mananatiling nakikita, kahit
    // lumaki pa ang sagot pababa.
    scrollBubbleIntoView(loadingBubble, thread);

    // BAGO: 6 -> 8 candidates, at 900 -> 1100 chars kada answer snippet.
    // Ang server (/api/ai-assistant/ask) ay tumatanggap na talaga ng
    // hanggang 8 context entries (300-char question / 1200-char answer
    // cap kada isa) mula pa noon, pero 6 lang dating pinapadala ng
    // client — kaya may reserved na grounding capacity na hindi
    // nagagamit. Ito ay mas maraming/mas kumpletong FAQ context papunta
    // sa AI model nang walang dagdag na backend change.
    const candidates = search(query, 8).map(r => ({
      question: r.entry.question,
      answer: stripHtml(r.entry.answer).slice(0, 1100)
    }));
    // Short-term memory sent to the server so the AI can handle natural
    // follow-up questions ("paano kung hindi gumana yun?") without the
    // user needing to repeat context — excludes the current question
    // itself, which is sent separately as the primary "question" field.
    //
    // BAGO: kapag mahaba na ang usapan, bukod sa huling 8 turns (verbatim),
    // idinaragdag din bilang unang entry ang isang maigsing (extractive)
    // buod ng mga naunang tanong (see summarizeOlderTurns) — sa halip na
    // basta itapon nang tuluyan ang konteksto ng buong mas lumang bahagi
    // ng usapan.
    const priorTurns = chatHistory.slice(0, -1);
    const recentTurns = priorTurns.slice(-8);
    const olderTurns = priorTurns.slice(0, -8);
    const olderSummary = summarizeOlderTurns(olderTurns);
    const historyPayload = [
      ...(olderSummary ? [olderSummary] : []),
      ...recentTurns
    ].map(h => ({ role: h.role, text: h.text }));

    const imagesToSend = pendingAttachments.filter((x) => x.kind === 'image').map((x) => x.dataUrl);
    const filesToSend = pendingAttachments.filter((x) => x.kind === 'file').map((x) => ({ data: x.dataUrl, name: x.name }));
    const wantsDiagnostics = pendingDiagnosticsRequested;
    pendingDiagnosticsRequested = false;
    clearImage();

    const aiController = new AbortController();
    aiAskController = aiController;

    try {
      const res = await authFetch(`${API_URL}/ai-assistant/ask`, {
        method: 'POST',
        signal: aiController.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: query,
          lang,
          context: candidates,
          history: historyPayload,
          images: imagesToSend.length ? imagesToSend : undefined,
          files: filesToSend.length ? filesToSend : undefined,
          model: getAiModelChoice() || undefined,
          diagnostics: wantsDiagnostics ? gatherDiagnostics() : undefined,
          clientErrors: wantsDiagnostics ? (CAPTURED_ERRORS.length ? CAPTURED_ERRORS : [s.noErrorsCaptured]) : undefined
        }),
        // BUGFIX: dati 30s — mas maikli pa sa kabuuang oras na ibinibigay
        // ng server/RELAY (at ng vision→text fallback), kaya pumapalya
        // ("Try again") ang mabagal pero tumatakbo pang request.
        timeoutMs: 90000
      });
      const data = await res.json().catch(() => null);

      // AI credit/billing: monthly quota exhausted — offer a support
      // ticket instead of silently failing.
      if (res.status === 402 && data && (data.creditsExhausted || data.dailyLimitReached)) {
        refreshAiCreditPill(data);
        const ps = planStrings();
        loadingBubble.querySelector('.faq-chat-bubble').innerHTML = `
          <div class="faq-ai-fallback-notice"><i class="fa-solid ${data.dailyLimitReached ? 'fa-hourglass-end' : 'fa-battery-empty'}"></i>
            <span>${escapeHtml(data.message || s.creditsExhausted)}</span>
          </div>
          ${(data.dailyLimitReached && !(aiModelOfferCache.data && aiModelOfferCache.data.dayBoost && !(Array.isArray(aiModelOfferCache.data.dayBoost.options) && aiModelOfferCache.data.dayBoost.options.some((o) => o && o.canPurchase)))) ? `<button type="button" class="faq-chip" id="faq-credit-boost-btn"><i class="fa-solid fa-bolt"></i> ${escapeHtml(ps.boostChip)}</button>` : ''}
          <button type="button" class="faq-chip" id="faq-credit-upgrade-btn"><i class="fa-solid fa-arrow-up-right-dots"></i> ${escapeHtml(ps.upgradeBtn)}</button>
          <button type="button" class="faq-chip" id="faq-credit-exhausted-ticket-btn"><i class="fa-solid fa-life-ring"></i> ${escapeHtml(s.quickTicket)}</button>`;
        loadingBubble.querySelector('#faq-credit-upgrade-btn')?.addEventListener('click', () => openAiPlansModal());
        loadingBubble.querySelector('#faq-credit-boost-btn')?.addEventListener('click', () => { openAiPlansModal._scrollBoost = true; openAiPlansModal(); });
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
        lastAiFailure = {
          status: res.status,
          providerUnavailable: !!(data && data.providerUnavailable),
          providerExhausted: !!(data && data.providerExhausted),
          retryAt: Number(data && data.retryAt) || 0,
          freeTierLimit: !!(data && (data.freeTierLimit || data.subscriptionRequired)),
          message: (data && data.message) || ''
        };
        // Ibinalik na ng RELAY ang credits ng palyang request — i-refresh
        // ang credit pill para tugma ang ipinapakitang balanse.
        if (data && data.credits) { try { refreshAiCreditPill(data.credits); } catch (e) {} }
        loadingBubble.remove();
        return false;
      }

      const answerText = (data.answer || '').trim();
      if (!answerText) { lastAiFailure = { status: res.status, providerUnavailable: false, message: 'empty' }; loadingBubble.remove(); return false; }

      chatHistory.push({ role: 'assistant', text: answerText.slice(0, 500) });
      if (data.credits) refreshAiCreditPill(data.credits);

      const bubbleInner = loadingBubble.querySelector('.faq-chat-bubble');
      const contextBadge = data.aiContext && data.aiContext.liveStoreData
        ? `<span class="faq-ai-live-context" title="Gumamit ang AI ng relevant live OmniPOS store data"><i class="fa-solid fa-database"></i> Live data</span>`
        : '';
      bubbleInner.innerHTML = `<div class="faq-ai-badge">${omniLogoIcon('1.1em', false)} ${s.aiGeneratedBadge} ${contextBadge}</div>`;
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
        wireAiBubbleActions(loadingBubble, query, answerText, thread, data.interactionId);
        renderSuggestedActions(bubbleInner, data.suggestedActions);
        renderFollowUpChips(bubbleInner, candidates, query, thread);
        // BAGO: hindi na ito puwersahang isinasagad sa ilalim
        // (scrollHeight) ng thread — nananatili sa itaas ng view ang
        // simula ng sagot (see scrollBubbleIntoView sa itaas kanina),
        // dito ipina-refresh lang ang visibility ng floating
        // "scroll to bottom" na buton batay sa bagong laki ng thread.
        updateScrollToBottomButton(thread);
      });
      return true;
    } catch (err) {
      // STOP: pinindot ng user ang Stop — itigil nang tahimik. Walang KB fallback, at hindi nasingil ang RELAY
      // (naputol ang request kaya ibinabalik ang credits at hindi dinadagdag ang neurons).
      if (aiController.signal.aborted) {
        lastAiFailure = null;
        const stoppedInner = loadingBubble.querySelector('.faq-chat-bubble');
        if (stoppedInner) stoppedInner.innerHTML = `<div class="faq-ai-fallback-notice"><i class="fa-solid fa-circle-stop"></i> <span>${escapeHtml(s.aiStopped)}</span></div>`;
        if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'user') chatHistory.pop();
        return true;
      }
      lastAiFailure = { status: 0, providerUnavailable: false, message: (err && err.message) || '' };
      loadingBubble.remove();
      return false;
    } finally {
      if (aiAskController === aiController) aiAskController = null;
    }
  }

  // BAGO: habang nag-lo-load ang AI (fullchat) response, pinapalitan ang
  // arrow-up icon ng send button ng umiikot na AI/robot icon, para
  // malinaw sa user na aktibong ginagana ang AI — bumabalik sa dati
  // (arrow-up) at naka-enable ulit ang buton pagkatapos, tagumpay man
  // o nag-fail ang request (see try/finally sa OmniFAQ.ask()).
  // BAGO: sa FAQ (Search) mode, magnifying-glass (Search) ang icon ng
  // send button sa halip na arrow-up; sa AI Chatbot mode, arrow-up pa rin.
  let sendButtonLoading = false;
  // Controller ng kasalukuyang tanong sa Omni AI — gamit ng Stop (send button habang umiikot).
  let aiAskController = null;
  function applySendButtonIcon() {
    const btn = document.getElementById('faq-send-btn');
    if (!btn || sendButtonLoading) return;
    const icon = btn.querySelector('i');
    if (!icon) return;
    const isSearch = effectiveAiMode() !== 'ai';
    const s = STRINGS();
    icon.innerHTML = '';
    icon.className = isSearch ? 'fa-solid fa-magnifying-glass' : 'fa-solid fa-arrow-up';
    const label = isSearch ? (s.searchTitle || 'Search') : (s.sendTitle || 'Send');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    // Placeholder ng input ay sumusunod din sa mode: FAQ -> "Search FAQ...",
    // AI Chatbot -> "Reply to OmniAI...".
    const inputEl = document.getElementById('faq-ai-input');
    if (inputEl) {
      inputEl.placeholder = isSearch ? s.searchPlaceholder : s.chatPlaceholder;
      // BAGO: sa mobile keyboard, "Search/Go" ang action key sa FAQ (Search)
      // mode; "Send" naman sa AI Chatbot mode.
      inputEl.setAttribute('enterkeyhint', isSearch ? 'search' : 'send');
    }
    syncSendButtonReady();
  }
  // BAGO: sa FAQ (Search) mode, ang magnifying-glass ay mukhang disabled
  // (kulay abo) habang walang laman ang search box, at nagiging buong
  // kulay (ready to search) pagka-type ng kahit anong text. Hindi ginagamit
  // ang `disabled` attribute para hindi masira ang click/Enter flow; klase
  // lang (faq-send-idle) ang nagpapabago ng itsura. Sa AI Chatbot mode,
  // hindi ito ginagalaw (laging buong kulay ang arrow-up).
  function syncSendButtonReady() {
    const btn = document.getElementById('faq-send-btn');
    if (!btn) return;
    const inputEl = document.getElementById('faq-ai-input');
    const isSearch = effectiveAiMode() !== 'ai';
    const empty = !inputEl || !String(inputEl.value || '').trim();
    const idle = isSearch && empty;
    btn.classList.toggle('faq-send-idle', idle);
    if (isSearch) btn.setAttribute('aria-disabled', idle ? 'true' : 'false');
    else btn.removeAttribute('aria-disabled');
  }
  function setSendButtonLoading(loading) {
    const btn = document.getElementById('faq-send-btn');
    if (!btn) return;
    const icon = btn.querySelector('i');
    if (!icon) return;
    sendButtonLoading = !!loading;
    if (loading) {
      // Umiikot pa rin ang logo, may maliit na stop square sa gitna: pindutin para itigil ang tanong.
      const stopLabel = (STRINGS().stopTitle || 'Stop');
      icon.className = '';
      icon.innerHTML = '<span style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:1.15em;height:1.15em;vertical-align:-0.2em;">' +
        omniLogoIcon('1.15em', true) +
        '<span style="position:absolute;width:.34em;height:.34em;border-radius:2px;background:currentColor;"></span></span>';
      btn.disabled = false;
      btn.classList.add('faq-send-stop');
      btn.title = stopLabel;
      btn.setAttribute('aria-label', stopLabel);
    } else {
      btn.disabled = false;
      btn.classList.remove('faq-send-stop');
      applySendButtonIcon();
    }
  }

  window.OmniFAQ = {
    // Send button: habang may tinatakbong tanong, ang pindot ay STOP (itigil ang request); kung hindi, normal na send.
    onSendClick: function () {
      if (sendButtonLoading) {
        if (aiAskController) { try { aiAskController.abort(); } catch (e) {} }
        return;
      }
      const inputEl = document.getElementById('faq-ai-input');
      return window.OmniFAQ.ask(inputEl ? inputEl.value : '');
    },
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
        keepFaqResultBelowToggles(resultBox);
        // BAGO: pagkatapos mag-search (Enter / Go / Search button), isara
        // ang keyboard sa pamamagitan ng pag-blur ng search box.
        if (input) input.blur();
        return;
      }

      const thread = ensureThread(resultBox);
      const userBubble = appendUserBubble(thread, q, pendingAttachments.slice());
      chatHistory.push({ role: 'user', text: q });
      saveChatHistory();

      // BAGO: kada send ng tanong (composer, Enter key, o pag-click sa
      // isang suggested/follow-up question chip — iisa lang itong
      // ask() function ang tinatawag ng lahat ng ito), tiniyak muna na
      // makikita ang KASASEND lang na tanong (block:'start'), sa halip
      // na basta i-jump agad ang view papuntang PINAKA-ILALIM ng thread
      // (dating gawi — natatabunan agad ito ng lalabas na AI bubble).
      // Ang simula/head ng papasok na AI bubble naman ang tinitiyak na
      // makikita habang tumatagal (see scrollBubbleIntoView sa loob ng
      // askAIAssistantChat/appendKbAnswerBubble) — kahit mahaba pa ang
      // sagot, hindi na ito basta isasagad sa ilalim ang scroll.
      scrollBubbleIntoView(userBubble, thread);

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
    },
    newConversation: resetConversation,
    goTo: goTo,
    renderFullList: renderFullList,
    renderAiModeToggle: renderAiModeToggle,
    syncAiUpsell: syncAiUpsell,
    refreshAiFree: function () { aiFreeRetryCount = 0; loadAiFreeStatus(true); },
    openAiPlans: openAiPlansModal,
    search: search,
    suggest: suggest,
    onInput: function (value) {
      renderSuggestions(value);
      syncSendButtonReady();
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
        // IME composition (hal. Android/JP keyboards): huwag i-send.
        if (event.isComposing || event.keyCode === 229) return;
        // Shift+Enter = bagong linya (textarea na ang input).
        if (event.shiftKey) return;
        // AI Chatbot mode sa touch device: Enter = bagong linya (parang
        // Claude), ang Send button ang nagpapadala. Sa Search mode,
        // laging Enter = search kahit sa mobile.
        if (effectiveAiMode() === 'ai' && isTouchPrimaryInput()) return;
        if (confirmActiveSuggestion()) {
          event.preventDefault();
          if (effectiveAiMode() !== 'ai') event.target.blur();
          return;
        }
        event.preventDefault(); // pigilan ang pagpasok ng newline sa textarea
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
    applyFullChatMode: applyFullChatMode,
    // BAGO: pampublikong access sa "unanswered questions" analytics log
    // (see UNANSWERED_LOG_KEY sa itaas) — para magamit ito ng
    // admin/developer, hal. sa dev console (`OmniFAQ.getUnansweredLog()`)
    // o kalaunan sa isang admin analytics page, para malaman kung anong
    // mga tanong ang madalas hindi nasasagot ng kasalukuyang FAQ.
    getUnansweredLog: loadUnansweredLog,
    clearUnansweredLog: clearUnansweredLog
  };

  

  document.addEventListener('DOMContentLoaded', initFullListAndDeepLink);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initFullListAndDeepLink();
  }

  // ---- auto-expanding composer textarea ---------------------------------
  // Ang #faq-ai-input ay textarea na lumalaki ayon sa dami ng text (hanggang
  // max-height sa CSS, pagkatapos ay nag-i-scroll sa loob). Tinatawag ang
  // resize sa bawat pag-type, at pati sa PROGRAMMATIC na pagbabago ng
  // `.value` (clear pagkatapos mag-send, voice input, suggestion click, atbp.)
  // gamit ang value-setter hook sa mismong element — kaya hindi na kailangang
  // galawin ang bawat lugar na nagse-set ng input.value.
  function isTouchPrimaryInput() {
    try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
    catch (_) { return false; }
  }

  function autosizeFaqInput() {
    const el = document.getElementById('faq-ai-input');
    if (!el) return;
    if (el.offsetParent === null) { if (!el.value) el.style.height = ''; return; } // nakatago pa
    el.style.height = 'auto';
    const maxH = parseFloat(getComputedStyle(el).maxHeight) || 200;
    const needed = el.scrollHeight;
    el.style.height = Math.min(needed, maxH) + 'px';
    el.style.overflowY = needed > maxH ? 'auto' : 'hidden';
  }

  let faqAutosizeWired = false;
  function setupFaqInputAutosize() {
    const el = document.getElementById('faq-ai-input');
    if (!el || faqAutosizeWired) return;
    faqAutosizeWired = true;

    try {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value') ||
                   Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.get && desc.set) {
        Object.defineProperty(el, 'value', {
          configurable: true,
          get() { return desc.get.call(this); },
          set(v) { desc.set.call(this, v); autosizeFaqInput(); syncSendButtonReady(); }
        });
      }
    } catch (_) {}

    el.addEventListener('input', autosizeFaqInput);
    window.addEventListener('resize', autosizeFaqInput);
    window.addEventListener('orientationchange', autosizeFaqInput);

    // Pindutin ang blangkong bahagi ng composer = i-focus ang textarea.
    const box = document.getElementById('faq-composer');
    if (box) {
      box.addEventListener('click', (ev) => {
        if (ev.target.closest('button, a, textarea, input, .faq-suggest-box')) return;
        if (ev.target.closest('.faq-composer-actions')) return;
        el.focus();
      });
    }

    // Kapag ipinakita ang Help view (dating nakatago = walang sukat), i-sync ulit.
    if (typeof MutationObserver === 'function') {
      const view = document.getElementById('view-faq');
      if (view) new MutationObserver(autosizeFaqInput).observe(view, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    autosizeFaqInput();
  }

  function setupFaqVoiceInput() {
    const btn = document.getElementById('faq-voice-btn');
    const input = document.getElementById('faq-ai-input');
    if (!btn || !input || btn.dataset.voiceReady === '1') return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    btn.dataset.voiceReady = '1';
    if (!Recognition) {
      btn.classList.add('unsupported');
      btn.title = STRINGS_BY_LANG[currentLang()]?.voiceUnsupported || 'Voice input is not supported by this browser.';
      btn.setAttribute('aria-disabled', 'true');
      return;
    }

    // BAGO: dati, continuous = false — kaya kusang tumitigil ang mic ng
    // browser pagkatapos ng maikling pause (~1-2s) at naputol ang
    // pagsasalita ng user. Ngayon: tuloy-tuloy ang pakikinig, at kusa
    // lang tumitigil kapag tahimik na nang sapat na tagal (o kapag tinap
    // ulit ang mic / pinindot ang Send).
    // BAGO: hindi na kusang namamatay ang mic dahil sa katahimikan o haba
    // ng oras. Tumitigil LANG ito kapag pinindot ang stop (mic) button,
    // ang X (cancel), ang Send/Enter, o kapag may malubhang error (hal.
    // walang permiso sa mic). Kung tinapos ng browser ang session, kusa
    // itong ini-restart habang nakikinig pa.
    const RESTART_DELAY_MS = 60;            // maikling gap para hindi maputol ang susunod na salita
    const RESTART_IDLE_DELAY_MS = 300;      // mas mahabang gap kung walang narinig sa nagtapos na session (iwas mabilis na loop)
    const MAX_CONSECUTIVE_ERRORS = 3;       // ilang sunod-sunod na error bago sumuko

    let recognition = null;
    let listening = false;      // UI state
    let wantListening = false;  // intensyon ng user (para sa auto-restart)
    let baseText = '';          // text na nasa box bago/sa labas ng kasalukuyang session
    let skipCount = 0;          // ilang results ang hindi na isasama (kapag nag-edit ang user)
    let latestResultsLen = 0;
    let heardSpeech = false;
    let consecutiveErrors = 0;
    let restartTimer = null;

    const L = () => STRINGS_BY_LANG[currentLang()] || STRINGS_BY_LANG.en;
    const setListening = (active) => {
      listening = active;
      btn.classList.toggle('is-listening', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.setAttribute('aria-label', active ? (L().voiceListening || 'Listening… tap the microphone again to stop.') : (L().voiceInput || 'Voice input'));
      btn.title = active ? (L().voiceListening || 'Listening… tap the microphone again to stop.') : (L().voiceInput || 'Voice input');
      const icon = btn.querySelector('i');
      if (icon) icon.className = active ? 'fa-solid fa-stop' : 'fa-solid fa-microphone';
      // Waveform habang nakikinig (nakatago ang input); pagtigil, ibalik ang
      // input at lumitaw ang na-record na text.
      const composer = document.getElementById('faq-composer');
      if (composer) {
        const wasActive = composer.classList.contains('is-dictating');
        composer.classList.toggle('is-dictating', active);
        if (active && !wasActive) fillVoiceWave();
        if (!active && wasActive) {
          const wave = document.getElementById('faq-voice-wave');
          if (wave) wave.classList.remove('speaking');
          autosizeFaqInput();
        }
      }
    };
    // Waveform (horizontal na linya ng guhit, may tuldok sa magkabilang dulo).
    // Ang bilang ng guhit ay ayon sa lapad na available; gumagalaw nang
    // banayad, at lumalaki ang galaw kapag may nade-detect na salita.
    let suppressReveal = false;
    let speakingTimer = null;
    function ensureVoiceWave() {
      let wave = document.getElementById('faq-voice-wave');
      if (wave) return wave;
      const composer = document.getElementById('faq-composer');
      if (!composer) return null;
      wave = document.createElement('div');
      wave.id = 'faq-voice-wave';
      wave.className = 'faq-voice-wave';
      wave.setAttribute('aria-hidden', 'true');
      wave.addEventListener('click', () => btn.click()); // pindutin ang waveform = itigil
      const left = composer.querySelector('.faq-composer-actions-left');
      if (left) left.insertAdjacentElement('afterend', wave); else composer.appendChild(wave);
      return wave;
    }
    function fillVoiceWave() {
      const wave = ensureVoiceWave();
      if (!wave) return;
      const width = wave.clientWidth;
      if (!width) return;
      const PITCH = 6.5;
      const n = Math.max(12, Math.floor((width - 12) / PITCH));
      if (wave.children.length === n) return;
      wave.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const bar = document.createElement('span');
        const edge = Math.min(i, n - 1 - i);
        if (edge < 3) bar.className = 'dot';
        // pseudo-random pero pareho palagi para stable ang itsura
        const r1 = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
        bar.style.setProperty('--wave-dur', (1.15 + r1 * 0.5).toFixed(2) + 's');
        bar.style.setProperty('--wave-delay', (-(i * 0.06) % 1.6).toFixed(2) + 's');
        bar.style.setProperty('--wave-peak', (0.5 + r1 * 1.4).toFixed(2));
        wave.appendChild(bar);
      }
    }
    function pulseVoiceWave() {
      const wave = document.getElementById('faq-voice-wave');
      if (!wave) return;
      wave.classList.add('speaking');
      clearTimeout(speakingTimer);
      speakingTimer = setTimeout(() => wave.classList.remove('speaking'), 700);
    }
    window.addEventListener('resize', () => {
      const composer = document.getElementById('faq-composer');
      if (composer && composer.classList.contains('is-dictating')) fillVoiceWave();
    });
    const showVoiceError = (message) => {
      if (typeof window.Swal !== 'undefined' && typeof Swal.fire === 'function') Swal.fire({ toast: true, position: 'top', icon: 'warning', title: message, showConfirmButton: false, timer: 3000 });
    };
    // BAGO: siguraduhing ang PINAKABAGONG sinabi (dulo ng text) ang
    // nakikita sa maliit na single-line box — dati nananatili sa simula
    // ang view kaya nakatago ang bagong text kapag humaba na. Hindi
    // tinatawag ang focus() (iiwas sa pag-pop ng keyboard sa mobile).
    const scrollInputToEnd = () => {
      const apply = () => {
        try {
          if (document.activeElement === input) {
            const len = input.value.length;
            input.setSelectionRange(len, len);
          }
        } catch (_) {}
        input.scrollLeft = input.scrollWidth;
        input.scrollTop = input.scrollHeight;
      };
      apply();
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    };
    const clearTimers = () => {
      clearTimeout(restartTimer);
      restartTimer = null;
    };
    const finish = () => {
      wantListening = false;
      clearTimers();
      recognition = null;
      setListening(false);
      scrollInputToEnd();
    };
    // abort=false -> stop() (hinihintay pa ang huling final result);
    // abort=true  -> abort() (ginagamit kapag Send na, para hindi na
    // maibalik sa box ang text pagkatapos itong i-clear).
    function stopListening(abort) {
      wantListening = false;
      clearTimers();
      const r = recognition;
      if (!r) { finish(); return; }
      if (abort) { r.onresult = null; }
      try { abort ? r.abort() : r.stop(); } catch (_) { finish(); return; }
      if (abort) finish();
    }

    // BUG FIX (nauulit ang text): sa Android Chrome, kapag continuous +
    // interimResults, KADA update ng sinasabi ay lumalabas bilang BAGONG
    // entry sa event.results (hal. "Bakit" -> "Bakit yung" -> "Bakit yung
    // narinig"...) sa halip na iisang entry na napapalitan. Kapag idinikit
    // lahat ng entries, nagiging "Bakit Bakit yung Bakit yung narinig...".
    // Dito pinagsasama nang matalino ang mga piraso: kung ang bagong piraso
    // ay pagpapahaba/pagwawasto ng nauna, papalitan ito (hindi idadagdag);
    // kung magkaibang parirala talaga, saka lang idadagdag.
    const speechWords = (s) => s.toLowerCase().replace(/[.,!?;:"“”]/g, '').split(/\s+/).filter(Boolean);
    const isWordPrefix = (shorter, longer) => {
      if (!shorter.length || shorter.length > longer.length) return false;
      for (let i = 0; i < shorter.length; i++) {
        if (i === shorter.length - 1) { if (!longer[i].startsWith(shorter[i])) return false; }
        else if (shorter[i] !== longer[i]) return false;
      }
      return true;
    };
    const sharedPrefixLen = (a, b) => {
      let n = 0;
      while (n < a.length && n < b.length && a[n] === b[n]) n++;
      return n;
    };
    const mergeSpeechPieces = (pieces) => {
      const merged = [];
      for (const piece of pieces) {
        if (!merged.length) { merged.push(piece); continue; }
        const last = merged[merged.length - 1];
        const lw = speechWords(last);
        const pw = speechWords(piece);
        if (!pw.length) continue;
        if (isWordPrefix(lw, pw)) { merged[merged.length - 1] = piece; continue; }   // pagpapahaba ng nauna
        if (isWordPrefix(pw, lw)) continue;                                           // mas maikling kopya ng nauna
        const minLen = Math.min(lw.length, pw.length);
        const shared = sharedPrefixLen(lw, pw);
        if (shared >= 2 && shared / minLen >= 0.75) {                                 // pagwawasto ng salita sa gitna/dulo
          if (pw.length >= lw.length) merged[merged.length - 1] = piece;
          continue;
        }
        // overlap sa dulo ng nauna at simula ng bago (sliding window)
        let overlap = 0;
        for (let k = Math.min(lw.length, pw.length) - 1; k >= 2; k--) {
          if (lw.slice(lw.length - k).join(' ') === pw.slice(0, k).join(' ')) { overlap = k; break; }
        }
        if (overlap) { merged[merged.length - 1] = last + ' ' + piece.split(/\s+/).slice(overlap).join(' '); continue; }
        merged.push(piece);
      }
      return merged.join(' ');
    };

    const startSession = () => {
      const r = new Recognition();
      recognition = r;
      let sessionHadResult = false;
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.lang = currentLang() === 'tl' ? 'fil-PH' : 'en-US';
      r.onstart = () => { setListening(true); };
      r.onresult = (event) => {
        if (recognition !== r) return;
        latestResultsLen = event.results.length;
        // Binubuo mula sa lahat ng results ng session (hindi lang ang
        // pinakabago) para hindi nawawala o dumodoble ang mga naunang
        // bahagi ng sinabi sa tuloy-tuloy na pakikinig.
        // Pinag-uugnay ng iisang espasyo ang bawat bahagi — may mga
        // browser na hindi naglalagay ng leading space sa mga sumunod
        // na result (kaya dati nagdidikit ang mga salita).
        const parts = [];
        for (let i = skipCount; i < event.results.length; i++) {
          const piece = String(event.results[i][0].transcript || '').trim();
          if (piece) parts.push(piece);
        }
        const transcript = mergeSpeechPieces(parts);
        if (!transcript) return;
        sessionHadResult = true;
        heardSpeech = true;
        consecutiveErrors = 0;
        pulseVoiceWave();
        const sep = baseText && !/\s$/.test(baseText) ? ' ' : '';
        input.value = baseText + sep + transcript;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (typeof window.OmniFAQ?.onInput === 'function') window.OmniFAQ.onInput(input.value);
        scrollInputToEnd();
      };
      r.onerror = (event) => {
        const lang = L();
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') { wantListening = false; showVoiceError(lang.voicePermissionDenied); }
        else if (event.error === 'audio-capture' || event.error === 'network' || event.error === 'language-not-supported') { wantListening = false; showVoiceError(lang.voiceError); }
        else if (event.error !== 'aborted' && event.error !== 'no-speech') {
          // ibang error: subukan ulit, pero sumuko kung paulit-ulit para hindi mag-loop.
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) { wantListening = false; }
          showVoiceError(lang.voiceError);
        }
      };
      r.onend = () => {
        if (recognition !== r) return;
        recognition = null;
        // Minsan kusang tinatapos ng browser (lalo na sa mobile) ang
        // session kahit tuloy pa ang user — i-restart nang tahimik,
        // habang nananatiling "listening" ang button.
        if (wantListening) {
          // BAGO: laging mag-restart habang gustong makinig ng user (hindi
          // na humihinto kahit tahimik o mahaba na ang oras). Kapag
          // nakaalis na sa Help page (nakatago ang input), itigil para
          // hindi tuloy-tuloy na nakabukas ang mic sa background.
          if (input.offsetParent === null) { finish(); return; }
          baseText = input.value.trim();
          skipCount = 0;
          latestResultsLen = 0;
          restartTimer = setTimeout(() => {
            restartTimer = null;
            if (!wantListening) return;
            if (input.offsetParent === null) { finish(); return; }
            try { startSession(); } catch (_) { finish(); }
          }, sessionHadResult ? RESTART_DELAY_MS : RESTART_IDLE_DELAY_MS);
          return;
        }
        finish();
      };
      r.start();
    };

    let dictOrigText = '';
    btn.addEventListener('click', () => {
      if (wantListening || listening) { stopListening(false); return; }
      dictOrigText = input.value;
      wantListening = true;
      heardSpeech = false;
      consecutiveErrors = 0;
      baseText = input.value.trim();
      skipCount = 0;
      latestResultsLen = 0;
      try { startSession(); } catch (_) { finish(); showVoiceError(L().voiceError); }
    });

    // X (cancel): itigil ang pakikinig at itapon ang na-record sa session na ito;
    // ibalik ang text na nasa box bago magsimula ang dictation.
    const cancelBtn = document.getElementById('faq-voice-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      suppressReveal = true;
      stopListening(true);
      suppressReveal = false;
      input.value = dictOrigText;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      autosizeFaqInput();
    });

    // Kapag nag-type/nag-edit mismo ang user habang nakikinig, huwag
    // burahin ang ginawa niya — gawing bagong baseng text ito.
    input.addEventListener('input', (e) => {
      if (!e.isTrusted || !wantListening) return;
      baseText = input.value;
      skipCount = latestResultsLen;
    });
    // Send (button o Enter) = itigil agad ang mic para hindi na
    // maibalik ang text sa box pagkatapos itong ma-clear.
    const sendBtn = document.getElementById('faq-send-btn');
    if (sendBtn) sendBtn.addEventListener('click', () => { if (wantListening || listening) stopListening(true); }, true);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (wantListening || listening)) stopListening(true); }, true);
  }

  function initFullListAndDeepLink() {
    renderFullList();
    wireFaqPageLock();
    renderAiModeToggle();
    setupAiFreeAutoCheck();
    setupSlashShortcut();
    setupFaqComposerKeyboardHandling();
    setupFaqInputAutosize();
    setupFaqVoiceInput();
    setupQuickActionsToggle();
    setupFaqFloatLayout();
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
