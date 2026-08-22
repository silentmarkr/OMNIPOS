

(function () {
  const STORAGE_KEY = 'omnipos_faq_lang';
  const DEFAULT_LANG = 'en';

  function getStoredLang() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return (v === 'en' || v === 'tl') ? v : null;
    } catch (e) { return null; }
  }

  function storeLang(lang) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  }

  function dataFor(lang) {
    return lang === 'tl' ? (window.OMNIPOS_FAQ_KB_TL || []) : (window.OMNIPOS_FAQ_KB_EN || []);
  }

  let currentLang = getStoredLang() || DEFAULT_LANG;

  // Make the active dataset available under the name faq-engine.js reads.
  window.OMNIPOS_FAQ_KB = dataFor(currentLang);

  const UI_TEXT = {
    en: {
      pageTitle: 'Frequently Asked Questions (FAQ)',
      intro: 'Choose a question below, or search above, to learn how to use OmniPOS.',
      askLabel: 'Ask about OmniPOS',
      placeholder: 'e.g. how to void a transaction, what is a shift, how to use a promo code...',
      searchBtn: 'Search',
      commonQuestions: 'Common Questions'
    },
    tl: {
      pageTitle: 'Mga Madalas Itanong (FAQ)',
      intro: 'Pumili ng tanong sa ibaba, o maghanap sa itaas, para matuto gumamit ng OmniPOS.',
      askLabel: 'Magtanong tungkol sa OmniPOS',
      placeholder: 'hal. paano mag-void ng transaction, ano ang shift, paano gumamit ng promo code...',
      searchBtn: 'Hanapin',
      commonQuestions: 'Mga Karaniwang Tanong'
    }
  };

  function applyStaticText(lang) {
    const t = UI_TEXT[lang];

    const pageTitle = document.getElementById('page-title-faq');
    if (pageTitle) pageTitle.textContent = t.pageTitle;

    const intro = document.querySelector('.faq-intro-text');
    if (intro) intro.textContent = t.intro;

    const askLabelText = document.getElementById('faq-ai-label-text');
    if (askLabelText) askLabelText.textContent = t.askLabel;

    const input = document.getElementById('faq-ai-input');
    if (input) input.placeholder = t.placeholder;

    const btnText = document.getElementById('faq-ai-btn-text');
    if (btnText) btnText.textContent = t.searchBtn;

    const commonHeading = document.getElementById('faq-common-heading');
    if (commonHeading) commonHeading.textContent = t.commonQuestions;
  }

  function updateToggleUI(lang) {
    document.querySelectorAll('.faq-lang-option').forEach(function (btn) {
      const isActive = btn.getAttribute('data-lang') === lang;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    const track = document.getElementById('faq-lang-toggle');
    if (track) track.setAttribute('data-active', lang);
  }

  function refreshFaqUI() {
    if (window.OmniFAQ && typeof window.OmniFAQ.hideSuggestions === 'function') {
      window.OmniFAQ.hideSuggestions();
    }
    const input = document.getElementById('faq-ai-input');
    const result = document.getElementById('faq-ai-result');
    if (input) input.value = '';
    if (result) result.innerHTML = '';
    if (window.OmniFAQ && typeof window.OmniFAQ.renderFullList === 'function') {
      window.OmniFAQ.renderFullList();
    }
  }

  function setLang(lang) {
    if (lang !== 'en' && lang !== 'tl') return;
    currentLang = lang;
    storeLang(lang);
    window.OMNIPOS_FAQ_KB = dataFor(lang);
    applyStaticText(lang);
    updateToggleUI(lang);
    refreshFaqUI();
  }

  window.OmniFAQLang = {
    get: function () { return currentLang; },
    set: setLang
  };

  function init() {
    applyStaticText(currentLang);
    updateToggleUI(currentLang);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
