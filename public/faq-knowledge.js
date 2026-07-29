// ====================================================================
// OMNIPOS FAQ KNOWLEDGE BASE
// ====================================================================
// Ito ang "sariling database" ng buong process at business logic ng
// OmniPOS system — hinango direkta mula sa aktwal na backend logic
// (server.js) at frontend behavior (app.js/index.html), hindi basta
// generic na sagot. Ginagamit ito ng faq-engine.js para sagutin ang
// kahit anong itatanong ng user sa FAQ search box nang "parang totoong
// AI na nag-research", sa halip na 11 static na tanong lang.
//
// BAWAT ENTRY:
//   id        - unique identifier
//   category  - pangkat ng topic (ginagamit sa "Related Topics")
//   question  - ang pangunahing katanungan (madaling intindihin)
//   keywords  - listahan ng salita/parirala (Tagalog + English + slang)
//               na dapat tumugma kapag nag-search ang user; ito ang
//               pinaka-mahalagang bahagi para gumana ang "AI-like"
//               pagtugma kahit hindi eksaktong parehong salita.
//   answer    - HTML string, format bilang propesyonal/structured na
//               sagot (may bold labels, listahan ng steps, at "Note"
//               kung saan may mahalagang business rule).
//   verdict   - OPTIONAL. Para lang sa mga tanong na talagang Oo/Hindi/
//               Depende ang tamang direktang sagot ('oo' | 'hindi' |
//               'depende'). Ginagamit ito ng faq-engine.js para maglagay
//               ng malinaw na Oo/Hindi/Depende badge sa itaas ng sagot
//               kapag na-detect na "yes/no"-type ang tanong ng user
//               (hal. "pwede ba...", "kailangan ba...", "ligtas ba...").
//               HUWAG lagyan ng verdict ang mga entry na hindi naman
//               talaga yes/no ang likas na tanong (hal. "paano gawin
//               ang X") — mali/nakaka-litong badge ang lalabas kung
//               ipipilit.
// ====================================================================

window.OMNIPOS_FAQ_KB = [

// ------------------------------------------------------------------
// 1. SYSTEM OVERVIEW
// ------------------------------------------------------------------
{
  id: 'overview-what-is',
  category: 'Overview',
  question: 'Ano ang OmniPOS?',
  keywords: ['ano ang omnipos', 'what is omnipos', 'tungkol sa system', 'about the system', 'point of sale', 'pos system', 'anong app ito'],
  answer: `<p><strong>OmniPOS</strong> ay isang all-in-one <strong>Point-of-Sale (POS) at Inventory Management System</strong> — sumasaklaw ito sa buong retail cycle: pagbenta (POS Terminal), imbentaryo, purchase orders/reorder, customer loyalty, shift/Z-Reading, sales reports, at user/role management.</p>
  <p><strong>Tech stack:</strong></p>
  <ul>
    <li>Backend: Node.js + Express, gamit ang built-in <code>node:sqlite</code> module (iisang <code>database/omnipos.db</code> file, WAL mode para concurrent-safe)</li>
    <li>Authentication: bcrypt password hashing + random session tokens (walang plain username-based na "trust")</li>
    <li>Frontend: vanilla JS single-page app (<code>app.js</code>) na naka-serve mula sa <code>public/</code> folder</li>
    <li>Extra libraries: ExcelJS (Excel import/export), Multer (file upload), Nodemailer (Gmail OTP emails), html5-qrcode (barcode scan), JsBarcode (barcode generation)</li>
  </ul>
  <p>Dinisenyo ito para gumana kahit offline/local-network lang (Termux/Android-friendly), maliban sa mga feature na kailangan ng internet gaya ng OTP email verification.</p>`
},
{
  id: 'overview-offline',
  category: 'Overview',
  question: 'Kailangan ba ng internet para gumana ang OmniPOS?',
  keywords: ['internet', 'offline', 'walang internet', 'local network', 'no wifi'],
  verdict: 'depende',
  answer: `<p>Hindi kailangan ng internet ang mga <strong>core na feature</strong>: POS checkout, inventory, transactions, shift/Z-Reading, reports — gumagana ang mga ito basta naka-konekta lang sa parehong local network/device ang server at ang browser.</p>
  <p>Ang mga sumusunod lang ang <strong>nangangailangan ng aktibong internet connection</strong> dahil dumadaan sa Gmail SMTP server (Nodemailer):</p>
  <ul>
    <li>Email receipt sa customer</li>
    <li>OTP (One-Time Password/Code) verification — Receipt Customization (pagkatapos ng 2 libreng attempts), Pro Theme unlock, Factory Reset/backup email</li>
  </ul>`
},

// ------------------------------------------------------------------
// 2. LOGIN / AUTHENTICATION / SESSIONS
// ------------------------------------------------------------------
{
  id: 'login-how',
  category: 'Login & Sessions',
  question: 'Paano mag-login sa OmniPOS?',
  keywords: ['login', 'mag-login', 'paano mag login', 'sign in', 'log in form', 'username password'],
  answer: `<p>Ilagay ang <strong>username</strong> at <strong>password</strong> sa Login Form, tapos i-submit. Sa likod ng eksena (<code>POST /api/auth/login</code>):</p>
  <ol>
    <li>Hinahanap ang user (case-insensitive) sa database.</li>
    <li>Ive-verify ang password gamit ang <strong>bcrypt</strong>. May fallback: kung lumang <em>plaintext</em> pa ang naka-save (legacy account), pinapayagan pa rin ang tugma, tapos <strong>awtomatikong ini-encrypt (auto-migrate)</strong> ito sa bcrypt hash sa parehong request — kaya sa susunod na login, secured na ito.</li>
    <li>Kapag tama, gumagawa ng random <strong>session token</strong> (32-byte, server-generated) na magiging "Bearer token" ng lahat ng susunod na API calls — 8 oras ang bisa nito (sliding expiry, nare-refresh habang aktibo).</li>
    <li>Ibinabalik din agad ang Permission Matrix (menu access) ng role ng user, kaya alam kaagad ng frontend kung ano ang dapat ipakita.</li>
  </ol>
  <p><strong>Note:</strong> Rate-limited ang login sa <strong>5 attempts kada 10 minuto per IP</strong> para maiwasan ang brute-force.</p>`
},
{
  id: 'login-session-expiry',
  category: 'Login & Sessions',
  question: 'Gaano katagal ang session bago ma-logout automatic?',
  keywords: ['session expire', 'auto logout', 'gaano katagal login', 'session timeout', '8 hours'],
  answer: `<p>Ang session ay may <strong>8 oras</strong> na bisa, pero ito ay <strong>sliding expiry</strong> — kada valid request na gagawin mo, na-re-reset ang 8-hour countdown. Ibig sabihin, hindi ka ma-a-auto-logout habang aktibong ginagamit ang system; mag-e-expire lang ito kapag walang aktibidad nang 8 buong oras.</p>
  <p>In-memory lang ang pagkaka-store ng mga sessions — kaya kapag na-restart ang server (hindi lang na-refresh ang browser), automatic na ma-i-invalidate ang lahat ng aktibong sessions.</p>`
},
{
  id: 'login-active-sessions',
  category: 'Login & Sessions',
  question: 'Ano ang Active Sessions / Active Users?',
  keywords: ['active sessions', 'active users', 'sino naka login', 'ilang device naka-login'],
  answer: `<p>Ipinapakita rito ang lahat ng <strong>kasalukuyang naka-login</strong> na account (session), kasama ang username, role, at ilang minuto na sila naka-login. Kahit sinong naka-login ay pwedeng tumingin dito.</p>
  <p>Kung parehong user pero magkaibang device/tab, magkahiwalay silang row — kaya makikita mo kung may parehong account na naka-login sa maraming device nang sabay.</p>`
},
{
  id: 'logout-how',
  category: 'Login & Sessions',
  question: 'Paano mag-logout?',
  keywords: ['logout', 'mag logout', 'sign out'],
  answer: `<p>May Logout button sa profile/sidebar menu. Tinatawag nito ang <code>POST /api/auth/logout</code>, na agad na <strong>binubura ang session token sa server</strong> (hindi lang nire-remove sa browser) — kaya kahit may makakuha pa ng lumang token na iyon, hindi na ito magagamit.</p>`
},

// ------------------------------------------------------------------
// 3. ROLES & PERMISSIONS
// ------------------------------------------------------------------
{
  id: 'roles-permission-matrix',
  category: 'Roles & Permissions',
  question: 'Paano gumagana ang Roles at Permissions?',
  keywords: ['roles', 'permissions', 'permission matrix', 'access control', 'rbac', 'menu access', 'sino pwede'],
  answer: `<p>Gumagamit ang OmniPOS ng <strong>dynamic permission system</strong> — hindi na hardcoded sa code kung sino ang pwedeng makakita ng anong menu.</p>
  <ul>
    <li><strong>Menu Registry:</strong> isang listahan ng lahat ng feature/menu (POS Terminal, Products, Reports, Users, Logs, Customers, Shift/Z-Reading, Reorder Alerts, atbp.), pati na ang mga sub-permission (hal. "View All Cashiers' Transactions").</li>
    <li><strong>Roles table:</strong> bawat role (Admin, Staff, Cashier, o custom na role na ginawa ng Admin) ay may sariling on/off na setting kada menu — ito ang <strong>Permission Matrix</strong>, na-e-edit ng Admin sa Users tab, walang kailangang i-deploy na bagong code.</li>
    <li><strong>Admin role</strong> ay laging may "super-admin bypass" — laging may access sa lahat, kahit anong naka-set sa matrix.</li>
  </ul>
  <p><strong>Note:</strong> Hindi lang sa UI (button hide/show) ineenforce ang mga ito — kino-check din ito sa <strong>server side</strong> sa bawat kaukulang API endpoint (<code>requirePermission()</code> middleware), kaya hindi ito puwedeng i-bypass sa pamamagitan ng direktang pagtawag sa API.</p>`
},
{
  id: 'roles-default',
  category: 'Roles & Permissions',
  question: 'Ano ang default na roles sa OmniPOS?',
  keywords: ['default roles', 'admin staff cashier', 'anong roles meron'],
  answer: `<p>May 3 built-in na roles by default:</p>
  <ul>
    <li><strong>Admin</strong> — full access sa lahat ng menu, "protected" (hindi puwedeng burahin), laging may bypass sa lahat ng permission check.</li>
    <li><strong>Staff</strong> — POS Terminal, Dashboard, Products, Barcode, Transactions (sarili lang), Customers, Shift/Z-Reading (kasama ang sales amounts).</li>
    <li><strong>Cashier</strong> — POS Terminal, Transactions (sarili lang), Customers, Shift/Z-Reading, PERO <strong>hindi</strong> nakikita ang Gross Sales/Discount/Net Sales figures sa live shift view (privacy sa peso amounts).</li>
  </ul>
  <p>Puwede kang gumawa ng bago pang custom roles (hal. "Supervisor") sa Users tab, at i-configure ang eksaktong menu access nito sa Permission Matrix.</p>`
},
{
  id: 'roles-add-user',
  category: 'Roles & Permissions',
  question: 'Paano magdagdag ng bagong user o cashier account?',
  keywords: ['add user', 'bagong cashier', 'gumawa ng account', 'new employee account', 'magdagdag ng user'],
  answer: `<p>Pumunta sa <strong>Users</strong> tab (Admin access lang). I-click ang "Add User", punan ang username, password, at piliin ang role.</p>
  <p>Sa likod ng eksena: awtomatikong ini-<strong>bcrypt hash</strong> ang password bago i-save (hindi kailanman naka-plain text), at rate-limited ito (8 attempts kada 10 minuto) laban sa abuse.</p>`
},
{
  id: 'roles-edit-profile',
  category: 'Roles & Permissions',
  question: 'Paano mag-edit ng sariling profile (username/avatar)?',
  keywords: ['edit profile', 'palitan avatar', 'palitan username', 'update profile'],
  verdict: 'depende',
  answer: `<p>Sa Profile widget/dropdown, may "Edit Profile" option para palitan ang username at/o avatar. Depende ito sa <strong>edit_user_profile</strong> permission ng role mo:</p>
  <ul>
    <li>Kung <strong>naka-ON</strong> ang permission (o Admin ka), <strong>agad na naa-apply</strong> ang pagbabago.</li>
    <li>Kung <strong>naka-OFF</strong> (default para sa non-Admin), papasok muna ito sa <strong>Staff Requests</strong> bilang PENDING — kailangan pang mag-approve ang Admin bago ito magbisa.</li>
  </ul>
  <p><strong>Note:</strong> Kapag pinalitan ang username, awtomatikong ipinapasa ang bagong pangalan sa iyong aktibong session at nakasave na cart — hindi ka ma-lo-logout. Pero ang mga <strong>NAKARAAN nang transaksyon at logs</strong> ay sinasadyang iniiwan sa LUMANG pangalan (audit trail — snapshot ng pangalan noong ginawa ang aksyon).</p>`
},

// ------------------------------------------------------------------
// 4. POS TERMINAL / CHECKOUT
// ------------------------------------------------------------------
{
  id: 'pos-checkout',
  category: 'POS Terminal',
  question: 'Paano mag-checkout o magbenta gamit ang POS Terminal?',
  keywords: ['checkout', 'magbenta', 'paano bumili', 'pos terminal', 'sale', 'add to cart', 'scan barcode'],
  answer: `<p>Pumunta sa <strong>POS Terminal</strong>, piliin o i-scan (gamit ang camera/barcode scanner) ang mga produktong bibilhin para idagdag sa cart, tapos pindutin ang <strong>Checkout</strong>.</p>
  <p>Sa likod ng eksena (<code>POST /api/transactions</code>):</p>
  <ol>
    <li><strong>Stock Guard:</strong> bago talaga i-proceed, ve-verify muna ang server kung sapat pa ang available stock ng BAWAT item sa cart (importante ito kung maraming terminal/device na sabay-sabay nagbebenta). Kung kulang na sa ibang terminal, ire-reject ang buong transaksyon at malinaw na sasabihin kung aling produkto ang kulang/naubos.</li>
    <li>Kapag pumasa, awtomatikong babawasan ang stock, at ang <strong>cashier field ay galing sa authenticated session</strong> (hindi sa client) para hindi ito mapeke.</li>
    <li>Kung may naka-attach na customer, awtomatikong na-a-update ang loyalty points, total spent, at visit count.</li>
    <li>Ina-save ang buong transaction record kasama ang items, discount, payment method(s), at cashier.</li>
  </ol>`
},
{
  id: 'pos-promo-code',
  category: 'POS Terminal',
  question: 'Paano gamitin ang promo code sa POS Terminal?',
  keywords: ['promo code', 'discount code', 'coupon', 'promocode'],
  answer: `<p>Sa cart ng POS Terminal, ilagay ang promo code sa provided field. Ini-validate ito ng <code>GET /api/promocodes/:code/validate</code>:</p>
  <ul>
    <li>Kailangang <strong>active</strong> ang code (hindi disabled).</li>
    <li>Hindi pa <strong>na-expire</strong> (kung may expiration date).</li>
    <li>Kung may <strong>minimum spend</strong> na requirement, dapat naabot muna ito ng subtotal.</li>
    <li>Ang discount ay puwedeng <strong>percent</strong> (max 100%) o <strong>fixed peso amount</strong> — automatic na kino-cap ito para hindi lumagpas sa subtotal (walang negative total).</li>
  </ul>
  <p>Kahit sinong naka-login sa Terminal ay pwedeng gumamit ng valid promo code — normal na cashier operation ito, hindi kailangan ng espesyal na permission. Ang paggawa/pag-edit/pagbura ng promo codes ang siyang nangangailangan ng "products" permission (o Admin).</p>`
},
{
  id: 'pos-customer-loyalty',
  category: 'POS Terminal',
  question: 'Paano gumagana ang Customer Loyalty Points?',
  keywords: ['loyalty points', 'customer points', 'rewards', 'redeem points', 'select customer'],
  answer: `<p>Sa POS Terminal, may "Select Customer" option para i-attach ang isang registered customer sa transaksyon. Kapag na-checkout:</p>
  <ul>
    <li><strong>Kumikita ng 1 loyalty point kada ₱100</strong> ng net sale (naka-floor down, hal. ₱250 = 2 points).</li>
    <li>Kung may pini-redeem na points ang customer, ibinabawas muna ito bago idagdag ang bagong kinita.</li>
    <li>Awtomatikong na-a-update ang <code>totalSpent</code> at <code>visits</code> count ng customer.</li>
    <li>Makikita agad sa resibo ang points na kinita at ang bagong balance.</li>
  </ul>`
},
{
  id: 'pos-split-payment',
  category: 'POS Terminal',
  question: 'Puwede bang gumamit ng dalawang payment method sa isang benta?',
  keywords: ['split payment', 'dalawang payment', 'cash and gcash', 'multiple payment method'],
  verdict: 'oo',
  answer: `<p>Oo — sinusuportahan ang <strong>split/multiple payment methods</strong> sa iisang transaksyon (hal. bahagi Cash, bahagi GCash). Sa likod ng eksena, ang net sales ay ipinapamahagi ayon sa aktwal na halagang binayad kada method, para tama pa rin ang Cash-only na variance computation sa Z-Reading (hindi ma-overcount ang GCash/Card portion bilang physical cash).</p>`
},

// ------------------------------------------------------------------
// 5. INVENTORY / PRODUCTS
// ------------------------------------------------------------------
{
  id: 'inv-add-product',
  category: 'Inventory',
  question: 'Paano magdagdag ng bagong produkto sa Inventory?',
  keywords: ['add product', 'bagong produkto', 'magdagdag ng item', 'new product'],
  answer: `<p>Pumunta sa <strong>Inventory → Products</strong>, i-click ang button para magdagdag ng bagong item (Code, Name, Category, Price, Stock, Supplier, Expiry Date, Low Stock Threshold, Cost Price).</p>
  <p><strong>Note:</strong> Kung "products_direct_apply" ay naka-OFF para sa role mo (default para sa non-Admin), papasok muna ang pagbabago sa <strong>Staff Requests</strong> bilang PENDING approval ng Admin — hindi agad naa-apply.</p>`
},
{
  id: 'inv-import-export',
  category: 'Inventory',
  question: 'Paano mag-import o mag-export ng products (Excel/CSV)?',
  keywords: ['import products', 'export products', 'excel template', 'csv', 'bulk upload', 'maramihang produkto'],
  answer: `<p><strong>Import:</strong> pumunta sa Products page, i-download muna ang Excel <strong>template</strong> (<code>GET /api/products/template</code>) para sigurado ang tamang column format, punan ito, tapos i-upload (<code>POST /api/products/import</code>). May 10MB file size limit at rate-limited (20 attempts kada 10 minuto).</p>
  <p><strong>Export:</strong> may button para i-download ang kasalukuyang inventory bilang CSV file (Code, Name, Category, Price, Stock, Supplier, Expiry Date, Low Stock Threshold, Cost Price).</p>`
},
{
  id: 'inv-barcode',
  category: 'Inventory',
  question: 'Paano gumawa o mag-print ng barcode?',
  keywords: ['barcode', 'print barcode', 'generate barcode', 'scan produkto'],
  answer: `<p>Pumunta sa <strong>Inventory → Barcode</strong>. Gumagamit ito ng <strong>JsBarcode</strong> library para mabuo ang barcode ng bawat produkto batay sa product code, na puwedeng i-print para gamitin sa pag-scan tuwing may benta sa POS Terminal (gamit ang <strong>html5-qrcode</strong> camera scanner o hardware barcode scanner).</p>`
},
{
  id: 'inv-low-stock',
  category: 'Inventory',
  question: 'Paano malalaman kung anong produkto na ang mababa na ang stock?',
  keywords: ['low stock', 'mababang stock', 'out of stock', 'reorder alert', 'lowstock'],
  answer: `<p>May <strong>Reorder Alerts</strong> page (<code>GET /api/products/low-stock</code>) na nagpapakita ng lahat ng produktong bumaba na sa kanilang Low Stock Threshold. Kasama dito ang tracking kung <strong>ilang araw na</strong> itong naka-flag bilang low/out-of-stock (auto-clear kapag na-restock na pataas sa threshold).</p>
  <p>Mula rito, puwede kang:</p>
  <ul>
    <li><strong>Quick Restock</strong> — direktang magdagdag ng stock (kung "restock_direct_apply" naka-ON, agad na naa-apply; kung hindi, papasok muna sa Staff Requests).</li>
    <li>Gumawa ng <strong>Purchase Order</strong> per-supplier para sa mas maayos na tracking ng pag-order.</li>
  </ul>`
},
{
  id: 'inv-purchase-order',
  category: 'Inventory',
  question: 'Paano gumagana ang Purchase Orders?',
  keywords: ['purchase order', 'po', 'order sa supplier', 'receive order', 'cancel order'],
  answer: `<p>Sa Reorder Alerts / Purchase Orders page, puwede kang gumawa ng Purchase Order per supplier — piliin ang mga item at quantity na iaayos.</p>
  <p><strong>Status flow:</strong> <code>ordered</code> → <code>received</code> o <code>cancelled</code></p>
  <ul>
    <li><strong>Receive:</strong> kapag dumating na ang order, i-click ang "Receive" — <strong>awtomatikong idadagdag sa stock</strong> ang lahat ng items dito.</li>
    <li><strong>Cancel:</strong> kung hindi natuloy ang order, i-cancel na lang (hindi na maaapply pa sa stock).</li>
  </ul>
  <p>Kailangan ng "reorder" permission para makagawa/makapag-receive/makapag-cancel ng Purchase Orders.</p>`
},

// ------------------------------------------------------------------
// 6. TRANSACTIONS / VOID
// ------------------------------------------------------------------
{
  id: 'tx-view',
  category: 'Transactions',
  question: 'Saan ko makikita ang lahat ng naibentang transaksyon?',
  keywords: ['view transactions', 'transaction history', 'listahan ng benta', 'sales history'],
  answer: `<p>Sa <strong>Transactions</strong> tab. Default, makikita mo lang ang <strong>sarili mong</strong> mga transaksyon (bilang cashier). Kung may "transactions_view_all" permission ang role mo (o Admin ka), makikita mo ang transaksyon ng LAHAT ng cashier.</p>`
},
{
  id: 'tx-void',
  category: 'Transactions',
  question: 'Paano ma-void o makansela ang isang transaction?',
  keywords: ['void transaction', 'kanselahin', 'cancel transaction', 'undo sale', 'refund'],
  answer: `<p>Sa <strong>Transactions</strong>, hanapin ang order na gustong i-void, tapos i-click ang void option. Hihingan ka ng <strong>Admin password</strong> bago matuloy (<code>POST /api/transactions/:id/void</code>):</p>
  <ol>
    <li>Ive-verify muna ang admin password gamit ang bcrypt.</li>
    <li>Kapag tama, <strong>awtomatikong ibabalik ang stock</strong> ng lahat ng items sa transaksyon papunta sa imbentaryo.</li>
    <li>Aalisin ang transaksyon sa listahan (hindi lang markahan — talagang tinatanggal), pero <strong>naka-log pa rin</strong> ang buong detalye (kasama ang voided amount) para sa audit trail at para ma-tally sa Z-Reading.</li>
  </ol>
  <p><strong>Note:</strong> Rate-limited sa 8 attempts kada 10 minuto laban sa pag-guess ng admin password.</p>`
},

// ------------------------------------------------------------------
// 7. SHIFT / Z-READING
// ------------------------------------------------------------------
{
  id: 'shift-what',
  category: 'Shift / Z-Reading',
  question: 'Ano ang Shift / Z-Reading?',
  keywords: ['shift', 'z-reading', 'zreading', 'end of day report', 'cash count'],
  answer: `<p>Ang "Shift" ay ang period mula sa <strong>huling pagsara</strong> ng shift ng isang cashier (o simula pa lang, kung wala pang isinasara) hanggang ngayon. <strong>Per-cashier</strong> ito (hindi store-wide) — bawat cashier, kahit anong device/terminal ang gamit niya, ay may sarili at hiwalay na open shift.</p>
  <p>Ang Z-Reading ay ang <strong>closing report</strong> na naglalaman ng: transaction count, gross sales, total discount, net sales, breakdown per payment method, void count/amount, at <strong>cash variance</strong> (short/over) base sa binilang na cash sa drawer.</p>`
},
{
  id: 'shift-open',
  category: 'Shift / Z-Reading',
  question: 'Paano magbukas ng shift (Beginning Cash Float)?',
  keywords: ['beginning cash', 'open shift', 'simulan ang shift', 'starting cash'],
  answer: `<p>Sa unang pagbubukas ng POS Terminal sa loob ng bagong shift period, ita-trigger ang prompt para maglagay ng <strong>Beginning Cash Float</strong> — ang halagang laman ng cash drawer bago magsimulang magbenta.</p>
  <p><strong>Naka-lock</strong> ito kapag na-set na (hindi na puwedeng palitan-palitan) hanggang sa susunod na close ng SARILING shift ng cashier na iyon. Hiwalay ang lock kada cashier — hindi apektado ng ibang cashier kahit magkaibang device.</p>`
},
{
  id: 'shift-close',
  category: 'Shift / Z-Reading',
  question: 'Paano isara ang shift / mag-Z-Reading?',
  keywords: ['close shift', 'isara ang shift', 'end shift', 'ending cash'],
  answer: `<p>Sa Shift/Z-Reading tab, i-click ang "Close Shift". Ilalagay mo ang <strong>Ending Cash Counted</strong> (aktwal na binilang na laman ng drawer). Kina-calculate ng system:</p>
  <ul>
    <li><strong>Expected Cash</strong> = Beginning Cash + Cash-method sales</li>
    <li><strong>Cash Variance</strong> = Ending Cash Counted − Expected Cash (negative = <strong>SHORT/kulang</strong>, positive = <strong>OVER/sobra</strong>)</li>
  </ul>
  <p>Hindi puwedeng mag-close kung walang bagong transaksyon O void mula sa huling pagsara. Pagkatapos mag-close, mare-reset ang Beginning Cash lock ng SARILI mong shift lang — kailangan mo nang mag-set ulit ng bago sa susunod mong pagbukas ng terminal.</p>`
},
{
  id: 'shift-supervisor-control',
  category: 'Shift / Z-Reading',
  question: 'Puwede bang isara ng Admin ang shift ng ibang cashier?',
  keywords: ['close other cashier shift', 'supervisor control', 'admin close shift ng iba', 'targetCashier'],
  verdict: 'depende',
  answer: `<p>Oo, kung may "<strong>shift_close_control</strong>" permission ang role mo (o Admin ka). Makikita ng Admin/Supervisor ang listahan ng lahat ng cashier na may kasalukuyang <strong>bukas</strong> na shift (<code>GET /api/shift/open-list</code>), at puwedeng piliin at isara ang shift nila — kahit ibang device/terminal pa ang pinagbuksan nito, online man ito o offline/lokal lang.</p>
  <p>Ordinaryong Cashier/Staff (walang permission na ito) ay makakapag-close lang ng <strong>sarili nilang</strong> shift.</p>`
},
{
  id: 'shift-cashier-hidden-amounts',
  category: 'Shift / Z-Reading',
  question: 'Bakit hindi ko makita ang Gross Sales/Net Sales bilang Cashier?',
  keywords: ['hindi makita sales amount', 'hidden peso amount', 'gross sales hindi lumalabas'],
  answer: `<p>Sinasadya ito — depende ito sa "<strong>shiftreport_view_amounts</strong>" permission ng role mo. Naka-OFF ito by default para sa Cashier role (privacy/control ng Admin sa peso figures), pero makikita pa rin nila ang transaction count at payment method breakdown (kailangan pa rin nila para sa cash counting/Z-Reading close nila).</p>
  <p><strong>Note:</strong> Ineenforce ito sa SERVER-SIDE (hindi lang itinatago sa UI) — kaya hindi ito ma-bypass kahit direktang tumawag sa API gamit ang browser devtools.</p>`
},

// ------------------------------------------------------------------
// 8. REPORTS
// ------------------------------------------------------------------
{
  id: 'reports-sales',
  category: 'Reports',
  question: 'Saan ko makikita ang kabuuang benta at pinaka-bestseller na produkto?',
  keywords: ['sales report', 'kabuuang benta', 'bestseller', 'top selling', 'gross income'],
  answer: `<p>Sa <strong>Sales Report</strong> makikita ang gross income, bilang ng transaksyon, at ranking ng top-selling na produkto — kinukuha ito nang <em>live</em> mula sa aktwal na transactions data (walang hiwalay na cache na kailangang i-refresh).</p>`
},
{
  id: 'reports-user-logs',
  category: 'Reports',
  question: 'Ano ang makikita sa User Logs?',
  keywords: ['user logs', 'audit trail', 'activity log', 'history ng aksyon'],
  answer: `<p>Ipinapakita rito ang history ng mga aksyon ng bawat user sa system — kung sino ang naglogin, nagbenta, nag-void, nag-approve/reject ng request, gumawa ng purchase order, atbp. — para sa accountability at audit trail. Kailangan ng "logs" permission para makita ito (Admin laging may access).</p>`
},

// ------------------------------------------------------------------
// 9. CUSTOMERS
// ------------------------------------------------------------------
{
  id: 'customers-add',
  category: 'Customers',
  question: 'Paano magdagdag ng customer profile?',
  keywords: ['add customer', 'customer profile', 'bagong customer', 'register customer'],
  answer: `<p>Sa <strong>Customers</strong> tab (kailangan ng "customers" permission), i-click ang Add Customer at punan ang detalye (pangalan, contact, email). Puwede ka ring mag-search ng existing customer.</p>`
},

// ------------------------------------------------------------------
// 10. RECEIPT CUSTOMIZATION / OTP
// ------------------------------------------------------------------
{
  id: 'receipt-customize',
  category: 'Receipt Settings',
  question: 'Paano i-customize ang store name/address/contact sa resibo?',
  keywords: ['receipt customization', 'store name', 'edit resibo', 'header footer resibo', 'paper size'],
  answer: `<p>Pumunta sa <strong>Receipt Settings</strong>. Doon mo mababago ang Store Name, Store Address, Store Contact, Header Text, Footer Text, at Paper Size (58mm/80mm).</p>
  <p><strong>May 2 LIBRENG pag-customize</strong> (hindi kasama ang Paper Size dahil hardware setting lang ito, hindi identity ng store). Pagkatapos maubos ang 2 free attempts, kailangan na ng <strong>OTP (One-Time Password/Code) verification</strong> — tingnan ang tanong tungkol sa Gmail App Password sa OTP.</p>`
},
{
  id: 'receipt-gmail-app-password',
  category: 'Receipt Settings',
  question: 'Bakit kailangan ng Gmail App Password sa Receipt Settings?',
  keywords: ['gmail app password', 'otp sender', 'why gmail password', 'app password setup'],
  answer: `<p>Ginagamit ang Gmail account (kasama ang <strong>App Password</strong> nito — 16-character code, hindi ang personal na password) para awtomatikong makapagpadala ng OTP email tuwing kailangan ng verification (receipt customization pagkatapos ng 2 free attempts, pro theme unlock, o factory reset backup).</p>
  <p><strong>Security note:</strong> Ang App Password ay <strong>hindi kailanman ibinabalik</strong> sa frontend/GET response — maski ang naka-configure nang sender email ay pino-partial-mask (hal. <code>ma***@gmail.com</code>) para lang ma-confirm na tama ang naka-save, hindi ang buong value.</p>`
},
{
  id: 'receipt-otp-flow',
  category: 'Receipt Settings',
  question: 'Paano gumagana ang OTP (One-Time Password/Code) verification?',
  keywords: ['otp', 'one time password', 'one time code', 'verification code'],
  answer: `<p>Ang <strong>OTP</strong> ay isang 6-digit na random code na:</p>
  <ol>
    <li>Kapag hiniling (hal. Receipt Customization pagkatapos ng 2 free attempts), gumagawa ng bagong code na valid lang sa loob ng <strong>10 minuto</strong>.</li>
    <li>Ipinapadala ito sa <strong>developer/store-owner na naka-registered na email</strong> — hindi sa user na humihiling — gamit ang naka-configure na Sender Gmail + App Password.</li>
    <li>Ang humiling ay kailangang ilagay ang code na natanggap para "ma-unlock" ang aksyon (save receipt settings, unlock Pro theme, atbp.).</li>
    <li>Isang beses lang magagamit ang code, at automatic itong nag-e-expire pagkatapos ng 10 minuto.</li>
  </ol>
  <p>Rate-limited ang OTP request/verify endpoints laban sa spam/brute-force ng 6-digit codes.</p>`
},
{
  id: 'themes-pro',
  category: 'Themes',
  question: 'Paano mag-unlock ng Pro Theme (Ocean, Emerald, Sunset, Rose Gold)?',
  keywords: ['pro theme', 'unlock theme', 'ocean pro', 'emerald pro', 'sunset pro', 'rosegold', 'bayad theme'],
  answer: `<p>Sa Themes menu, may 4 na Pro Theme (₱149 each): Ocean Pro, Emerald Pro, Sunset Pro, Rose Gold Pro. Server-side ang pag-unlock nito (hindi na basta localStorage na puwedeng i-bypass sa DevTools):</p>
  <ol>
    <li>Mag-request ng unlock — magpapadala ito ng OTP sa developer/store-owner email (parehong pattern ng Receipt Customization OTP).</li>
    <li>Kapag na-confirm ang OTP, naka-unlock na permanently ang theme para sa system na iyon.</li>
  </ol>`
},

// ------------------------------------------------------------------
// 11. BACKUP / RESTORE / SYSTEM RESET
// ------------------------------------------------------------------
{
  id: 'system-forgot-admin-password',
  category: 'System Reset',
  question: 'Nakalimutan ko ang admin password, paano ito ma-reset?',
  keywords: ['forgot password', 'nakalimutan password', 'reset admin password', 'lost password'],
  answer: `<p>Walang hiwalay na "forgot password" self-service form ang OmniPOS — dahil dito, ang paraan para makabalik ay ang <strong>System Reset (Hard Factory Reset)</strong>, na kailangang naka-setup na muna ang Gmail App Password sa Receipt Settings bago magamit ang feature na ito.</p>
  <p>Kapag ginamit ang Hard Reset: ipapadala muna ang <strong>buong backup</strong> (users, products, transactions, atbp.) sa iyong email bago burahin ang data, tapos ibabalik ang mga user account sa <strong>default set</strong> ng mga account. Tingnan ang tanong tungkol sa "System Reset / Factory Reset" para sa buong detalye.</p>
  <p><strong>Mahalagang paalala:</strong> Kailangan mo munang naka-access ang isang Admin account (kahit anong Admin) para ma-trigger ang Hard Reset — kailangan ng Admin session bago tumakbo ang endpoint na ito.</p>`
},
{
  id: 'system-reset-full',
  category: 'System Reset',
  question: 'Ano ang mangyayari kapag ginawa ang System Reset / Factory Reset?',
  keywords: ['factory reset', 'system reset', 'hard reset', 'clear all data', 'burahin lahat ng data'],
  answer: `<p>Ang <strong>Hard Factory Reset</strong> (<code>POST /api/system/reset</code>) ay ADMIN-ONLY na aksyon, at ito ang sequence:</p>
  <ol>
    <li>Kokolektahin ang <strong>KUMPLETONG backup</strong> ng lahat ng modules (users, products, transactions, logs, requests, categories, carts, receipt settings, customers, shifts) bilang isang JSON file.</li>
    <li>Ipapadala muna ang backup na ito sa email (via Gmail na ipinasok mo) — <strong>kung mag-fail ang email</strong> (hal. maling app password), <strong>ihihinto ang buong reset</strong> at LIGTAS pa rin ang data (walang mababawi kung walang na-confirm na backup email).</li>
    <li>Kapag successful ang email, saka lang isasagawa ang pagbura: babalik ang users sa default set of accounts, mababawasan sa blangko ang products/transactions/requests/carts/customers/shifts/logs, at babalik sa default categories.</li>
  </ol>
  <p><strong>Sinasadyang HINDI ginagalaw:</strong> ang Receipt Customization counter (customizeCount/firstCustomizedAt) — para hindi magamit ang Factory Reset bilang "loophole" para maibalik ang 2 free attempts. Kailangan pa rin ng hiwalay na OTP-gated reset-counter endpoint para dito.</p>`
},
{
  id: 'system-restore-backup',
  category: 'System Reset',
  question: 'Paano mag-restore mula sa backup file?',
  keywords: ['restore backup', 'ibalik ang backup', 'import backup file', 'recover data'],
  answer: `<p>Sa Restore Backup feature, kailangan ang Admin username, password, at ang backup JSON file (galing sa dating Factory Reset email o manual export). Kapag na-verify ang admin credentials, ise-synchronize ang lahat ng 7 modules (users, products, transactions, userlogs, requests, categories, carts) mula sa laman ng backup file.</p>`
},

// ------------------------------------------------------------------
// 12. STAFF REQUESTS / APPROVAL WORKFLOW
// ------------------------------------------------------------------
{
  id: 'requests-approval',
  category: 'Staff Requests',
  question: 'Ano ang Staff Requests at paano ito ina-approve?',
  keywords: ['staff requests', 'pending approval', 'approve reject', 'request approval'],
  answer: `<p>Kapag ang isang non-Admin role ay walang "direct apply" permission (hal. products_direct_apply, restock_direct_apply, o edit_user_profile naka-OFF), ang kanilang mga aksyon — magdagdag/mag-update/magbura ng produkto, mag-restock, o mag-edit ng sariling profile — ay <strong>hindi agad naa-apply</strong>. Sa halip, pumapasok ito sa <strong>Staff Requests</strong> bilang PENDING.</p>
  <p>Ang Admin lang ang makaka-approve o makaka-reject nito. Kapag na-approve, saka lang aktwal na maa-apply ang pagbabago sa database, at naka-log ang buong desisyon (kasama kung sino ang nag-approve/reject).</p>`
},

// ------------------------------------------------------------------
// 13. SECURITY / DATA INTEGRITY
// ------------------------------------------------------------------
{
  id: 'security-overview',
  category: 'Security',
  question: 'Anong mga security measures meron ang OmniPOS?',
  keywords: ['security', 'seguridad', 'proteksyon', 'ligtas ba ang data', 'safe ba'],
  verdict: 'oo',
  answer: `<p>Ilan sa mga built-in na proteksyon:</p>
  <ul>
    <li><strong>Bcrypt password hashing</strong> (kasama ang auto-migration ng lumang plaintext passwords)</li>
    <li><strong>Session token authentication</strong> — hindi na "trust the client" na username; lahat ng API (maliban sa login) ay nangangailangan ng valid Bearer token</li>
    <li><strong>Rate limiting</strong> sa lahat ng sensitibong endpoint (login, void, password reset, OTP, factory reset) — per-IP, sliding window</li>
    <li><strong>Dynamic role-based access control</strong>, ineenforce sa SERVER-SIDE, hindi lang sa UI</li>
    <li><strong>Admin password re-verification</strong> para sa mapanganib na aksyon (void transaction, restore backup)</li>
    <li>Static files na naka-serve ay <strong>public/ folder lang</strong> (hindi na ang buong project root) — para hindi ma-access publicly ang database file o source code</li>
    <li>Security HTTP headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)</li>
    <li>2MB JSON body limit at 10MB file upload limit laban sa DoS via malaking payload</li>
  </ul>`
},
{
  id: 'security-database',
  category: 'Security',
  question: 'Saan naka-store ang data ng OmniPOS?',
  keywords: ['saan naka store data', 'database file', 'sqlite', 'omnipos.db'],
  answer: `<p>Lahat ng 7+ modules (users, products, transactions, userlogs, requests, categories, carts, customers, promocodes, shifts, purchaseOrders, atbp.) ay nakatira sa <strong>iisang SQLite file</strong>: <code>database/omnipos.db</code>, gamit ang built-in <code>node:sqlite</code> module ng Node.js (walang kailangang i-compile/i-install na native module).</p>
  <p>Bentahe nito kumpara sa dating hiwalay na JSON files kada module: <strong>atomic writes</strong> (walang corrupted/half-written file kung mag-crash habang nagsusulat), <strong>WAL mode</strong> (safe sa concurrent requests), at iisang file na lang ang kailangang i-backup.</p>`
},

// ------------------------------------------------------------------
// 14. RECENT SYSTEM UPDATES / CHANGELOG
// ------------------------------------------------------------------
{
  id: 'update-latest-changes',
  category: 'System Updates',
  question: 'Ano ang mga bagong update o pagbabago sa OmniPOS?',
  keywords: ['bago', 'update', 'updates', 'changelog', 'ano ang bago', 'whats new', "what's new", 'latest changes', 'nabago sa system', 'recent changes', 'bagong feature', 'anong nabago'],
  answer: `<p>Narito ang mga pinakabagong pagbabago sa interface ng OmniPOS:</p>
  <ul>
    <li><strong>Mas maayos na Profile menu:</strong> ang dropdown ng user profile (sa itaas ng sidebar) ay awtomatikong nagsasara na ngayon kapag may ibang menu na binuksan, kapag pinindot ang labas nito, o kapag nag-scroll — para hindi na ito magpatong-patong sa ibang dropdown.</li>
    <li><strong>Hindi na lumalabas sa gilid ang Profile dropdown:</strong> limitado na ang taas nito batay sa laki ng screen, kaya kung mahaba ang listahan (hal. maraming Active Users), sa loob na lang ng dropdown mismo ito nag-iscroll sa halip na tumagilid palabas.</li>
    <li><strong>Page title na lumilipat sa Header sa Tablet/Cellphone:</strong> kapag ginagamit ang system sa tablet o cellphone, ang pamagat ng bawat pahina (hal. Dashboard, Products, FAQ) ay ipinapakita na ngayon sa itaas na Header — malapit sa notification bell — sa halip na sa loob ng page mismo, para mas maluwag ang tingin sa maliit na screen. Kusang nag-a-adjust din ang laki ng font nito batay sa lapad ng screen. Sa PC o Laptop, nananatili ang orihinal na ayos (nasa loob ng page ang title, hindi sa Header).</li>
  </ul>
  <p>Palagi itong ina-update sa tuwing may mga bagong pagbabago sa system — bumalik lang dito paminsan-minsan para sa pinakabagong impormasyon.</p>`
},
{
  id: 'update-profile-dropdown-behavior',
  category: 'System Updates',
  question: 'Bakit awtomatikong nagsasara ang Profile dropdown sa sidebar?',
  keywords: ['profile dropdown', 'user dropdown', 'nagsasara profile menu', 'dropdown auto close', 'profile menu closing', 'sidebar dropdown', 'nakalabas dropdown', 'sumosobra sa sidebar'],
  answer: `<p>Sinadya ang bagong ganitong ugali ng Profile dropdown (avatar/username sa itaas ng sidebar) para mas malinis at hindi nakakalito ang tingin:</p>
  <ul>
    <li>Kapag binuksan ang isa pang menu/dropdown (hal. ang Inventory group sa sidebar, o kapag pinili ang Themes/Active Users sa loob mismo ng Profile dropdown), awtomatikong isinasara muna ang ibang bukas na dropdown — iisa lang na dropdown ang bukas sa anumang oras.</li>
    <li>Kapag pinindot ang kahit saan sa labas ng dropdown, o kapag lumipat ng ibang page/view, isinasara agad ito.</li>
    <li>Kapag mag-scroll sa loob ng sidebar menu o sa laman ng page habang bukas ang dropdown, isinasara din agad ito — para hindi ito maiwang naka-float habang gumagalaw na ang tinitingnan mong content.</li>
    <li>Limitado na rin ang pinakamataas na taas ng dropdown batay sa laki ng screen, kaya hindi na ito "lumalabas"/tumagilid palabas ng sidebar kapag mahaba ang laman (hal. maraming naka-login na Active Users) — sa loob na lang ng dropdown mismo ito nag-iscroll.</li>
  </ul>`
},
{
  id: 'update-mobile-header-title',
  category: 'System Updates',
  question: 'Bakit nasa Header na ang page title kapag gamit ang tablet o cellphone?',
  keywords: ['page title header', 'title sa header', 'mobile title', 'tablet title', 'title bumabago pwesto', 'dashboard title header', 'title malapit sa bell', 'responsive title', 'font size title'],
  verdict: 'depende',
  answer: `<p>Depende ito sa laki/lapad ng screen ng device na ginagamit:</p>
  <ul>
    <li><strong>Sa Tablet o Cellphone</strong> (maliit na screen), inililipat ang pamagat ng kasalukuyang pahina — hal. <em>Dashboard, Products, Barcode Generator, Reorder Alerts, Sales Analytics, Transaction, Customers, Shift/Z-Reading, System Audit Logs, FAQ</em> — papunta sa itaas na Header, katabi lang (bago) ng notification bell, sa halip na sa loob ng page mismo. Kusang nade-detect ng system ang lapad ng screen at kusa na rin nag-a-adjust ang laki ng font ng title na ito para bagay sa maliit na screen.</li>
    <li><strong>Sa PC o Laptop</strong> (malaking screen), nananatili ang bawat pamagat sa ORIHINAL nitong pwesto — sa loob ng page/view mismo, hindi sa Header — gaya ng dati.</li>
  </ul>
  <p>Awtomatiko itong nag-aadjust din kapag binago ang laki ng browser window o kapag i-rotate ang tablet/cellphone (portrait/landscape).</p>`
},

];
