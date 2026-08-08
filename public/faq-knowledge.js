// ====================================================================
// OMNIPOS FAQ KNOWLEDGE BASE
// ====================================================================
// Ito ang "sariling database" ng FAQ Search (OmniFAQ) sa loob ng OmniPOS.
// Layunin nito na masagot ang halos anumang itanong ng user tungkol sa
// PAANO GAMITIN ang system — simpleng proseso lang, saan makikita ang
// isang feature, at ano ang mangyayari kapag ginamit ito.
//
// PAALALA: Panatilihing simple at malinaw ang bawat sagot. Iwasan ang
// paggamit ng teknikal na salita na hindi pamilyar sa ordinaryong user
// (hal. mga pangalan ng file, code, o kung paano gawa ang system sa
// loob) — dapat nakatuon lang ito sa proseso ng paggamit.
//
// BAWAT ENTRY:
//   id        - unique identifier
//   category  - pangkat ng topic (ginagamit sa "Related Topics")
//   question  - ang pangunahing katanungan (madaling intindihin)
//   keywords  - listahan ng salita/parirala (Tagalog + English + slang)
//               na dapat tumugma kapag nag-search ang user
//   answer    - HTML string, simpleng paliwanag lang ng proseso
//   verdict   - OPTIONAL. Para lang sa mga tanong na Oo/Hindi/Depende
//               ang tamang direktang sagot ('oo' | 'hindi' | 'depende')
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
  answer: `<p><strong>OmniPOS</strong> ay isang all-in-one <strong>Point-of-Sale (POS) at Inventory Management System</strong> — sumasaklaw ito sa buong proseso ng tindahan o negosyo:</p>
  <ul>
    <li>Pagbenta at checkout (POS Terminal)</li>
    <li>Pag-monitor ng imbentaryo/stock</li>
    <li>Barcode generator at pag-print ng resibo</li>
    <li>Purchase Orders at Reorder Alerts</li>
    <li>Customer Loyalty Points</li>
    <li>Shift / Z-Reading (pagsara ng benta kada shift)</li>
    <li>Sales Reports at User Logs</li>
    <li>Pamamahala ng users at ng kani-kanilang access (roles)</li>
  </ul>`
},
{
  id: 'overview-offline',
  category: 'Overview',
  question: 'Kailangan ba ng internet para gumana ang OmniPOS?',
  keywords: ['internet', 'offline', 'walang internet', 'local network', 'no wifi'],
  verdict: 'depende',
  answer: `<p>Hindi kailangan ng internet ang mga <strong>pangunahing feature</strong>: POS checkout, inventory, transactions, shift/Z-Reading, reports — gumagana ang mga ito basta naka-konekta lang sa parehong network ang device na gamit mo at ang system.</p>
  <p>Ang mga sumusunod lang ang <strong>nangangailangan ng aktibong internet connection</strong> dahil ipinapadala ito sa pamamagitan ng email:</p>
  <ul>
    <li>Pagpapadala ng email receipt sa customer</li>
    <li>OTP (One-Time Password/Code) verification — para sa Receipt Customization, Pro Theme unlock, at Factory Reset backup</li>
  </ul>`
},

// ------------------------------------------------------------------
// 2. LOGIN / SESSIONS
// ------------------------------------------------------------------
{
  id: 'login-how',
  category: 'Login & Sessions',
  question: 'Paano mag-login sa OmniPOS?',
  keywords: ['login', 'mag-login', 'paano mag login', 'sign in', 'log in form', 'username password'],
  answer: `<p>Ilagay lang ang <strong>username</strong> at <strong>password</strong> mo sa Login Form, tapos i-submit. Kapag tama ang detalye, direkta ka nang mapupunta sa Dashboard, at makikita mo lang ang mga menu na pinahintulutan para sa role mo.</p>
  <p><strong>Note:</strong> May limitasyon sa maling attempt (5 beses lang bawat 10 minuto) para sa proteksyon laban sa mga taong nagtatangkang hulaan ang password.</p>`
},
{
  id: 'login-session-expiry',
  category: 'Login & Sessions',
  question: 'Gaano katagal ang session bago ma-logout automatic?',
  keywords: ['session expire', 'auto logout', 'gaano katagal login', 'session timeout', '8 hours'],
  answer: `<p>Hindi ka ma-a-auto-logout habang aktibong ginagamit mo ang system. Kapag walang aktibidad nang <strong>8 buong oras</strong>, saka lang ito mag-e-expire at kailangan mo nang mag-login ulit.</p>
  <p><strong>Note:</strong> Kapag na-restart ang buong system (hindi lang na-refresh ang browser), kailangan mag-login ulit ang lahat ng naka-login noon.</p>`
},
{
  id: 'login-active-sessions',
  category: 'Login & Sessions',
  question: 'Ano ang Active Sessions / Active Users?',
  keywords: ['active sessions', 'active users', 'sino naka login', 'ilang device naka-login'],
  answer: `<p>Ipinapakita rito ang lahat ng <strong>kasalukuyang naka-login</strong> na account, kasama ang username, role, at ilang minuto na sila naka-login. Kahit sinong naka-login ay pwedeng tumingin dito.</p>
  <p>Kung magkaibang device o tab ang gamit ng parehong user, magkahiwalay silang makikita sa listahan.</p>`
},
{
  id: 'logout-how',
  category: 'Login & Sessions',
  question: 'Paano mag-logout?',
  keywords: ['logout', 'mag logout', 'sign out'],
  answer: `<p>May Logout button sa profile/sidebar menu. Kapag na-click ito, agad na hindi na magagamit ulit ang naunang session mo — kahit pa may makakuha ng lumang link o device na dati mong ginamit.</p>`
},

// ------------------------------------------------------------------
// 3. ROLES & PERMISSIONS
// ------------------------------------------------------------------
{
  id: 'roles-permission-matrix',
  category: 'Roles & Permissions',
  question: 'Paano gumagana ang Roles at Permissions?',
  keywords: ['roles', 'permissions', 'permission matrix', 'access control', 'menu access', 'sino pwede'],
  answer: `<p>Ang Admin ang nagtatakda kung anong menu o feature ang makikita/magagamit ng bawat role (Admin, Staff, Cashier, o custom na role) sa pamamagitan ng <strong>Permission Matrix</strong> sa Settings tab — simpleng on/off lang ito kada menu, hindi na kailangan mag-request ng developer para baguhin ito.</p>
  <p><strong>Admin</strong> ay laging may access sa lahat, kahit anong naka-set sa matrix.</p>`
},
{
  id: 'roles-default',
  category: 'Roles & Permissions',
  question: 'Ano ang default na roles sa OmniPOS?',
  keywords: ['default roles', 'admin staff cashier', 'anong roles meron'],
  answer: `<p>May 3 built-in na roles by default:</p>
  <ul>
    <li><strong>Admin</strong> — full access sa lahat ng menu, hindi puwedeng burahin.</li>
    <li><strong>Staff</strong> — POS Terminal, Dashboard, Products, Barcode, sariling Transactions, Customers, Shift/Z-Reading (kasama ang mga sales amount).</li>
    <li><strong>Cashier</strong> — POS Terminal, sariling Transactions, Customers, Shift/Z-Reading, pero <strong>hindi</strong> nakikita ang Gross Sales/Discount/Net Sales figures.</li>
  </ul>
  <p>Puwede kang gumawa ng bagong custom na role (hal. "Supervisor") sa Settings tab, at doon mo rin itatakda kung anong menu ang pwede nilang gamitin.</p>`
},
{
  id: 'roles-add-user',
  category: 'Roles & Permissions',
  question: 'Paano magdagdag ng bagong user o cashier account?',
  keywords: ['add user', 'bagong cashier', 'gumawa ng account', 'new employee account', 'magdagdag ng user'],
  answer: `<p>Pumunta sa <strong>Settings</strong> tab (Admin access lang), sa loob ng <strong>Users Management</strong> tab. I-click ang "Add User", punan ang username, password, at piliin ang role. Awtomatiko na ring naka-encrypt/naka-secure ang password na ilalagay mo — hindi ito kailanman naka-plain text.</p>`
},
{
  id: 'roles-edit-profile',
  category: 'Roles & Permissions',
  question: 'Paano mag-edit ng sariling profile (username/avatar)?',
  keywords: ['edit profile', 'palitan avatar', 'palitan username', 'update profile'],
  verdict: 'depende',
  answer: `<p>Sa Profile widget/dropdown, may "Edit Profile" option para palitan ang username at/o avatar mo. Depende ito sa setting na itinakda ng Admin para sa role mo:</p>
  <ul>
    <li>Kung pinahintulutan (o Admin ka), <strong>agad na naa-apply</strong> ang pagbabago.</li>
    <li>Kung hindi (karaniwan sa non-Admin), papasok muna ito sa <strong>Staff Requests</strong> bilang PENDING — kailangan pang mag-approve ang Admin.</li>
  </ul>
  <p><strong>Note:</strong> Ang mga <strong>nakaraan nang transaksyon at logs</strong> ay sinasadyang iniiwan sa lumang pangalan mo, para malinaw pa rin ang record ng nangyari noong panahong iyon.</p>`
},

// ------------------------------------------------------------------
// 4. POS TERMINAL / CHECKOUT
// ------------------------------------------------------------------
{
  id: 'pos-checkout',
  category: 'POS Terminal',
  question: 'Paano mag-checkout o magbenta gamit ang POS Terminal?',
  keywords: ['checkout', 'magbenta', 'paano bumili', 'pos terminal', 'sale', 'add to cart', 'scan barcode'],
  answer: `<p>Pumunta sa <strong>POS Terminal</strong>, piliin o i-scan (gamit ang camera o barcode scanner) ang mga produktong bibilhin para idagdag sa cart, tapos pindutin ang <strong>Checkout</strong>.</p>
  <ul>
    <li>Bago makumpleto ang benta, kino-check muna ng system kung sapat pa ang stock ng bawat item — importante ito kung maraming terminal na sabay-sabay nagbebenta. Kung kulang na, malinaw na sasabihin kung aling produkto ang hindi na sapat.</li>
    <li>Kapag pumasa, awtomatikong babawasan ang stock, at naitatala ang pangalan ng cashier na nagbenta.</li>
    <li>Kung may naka-attach na customer, awtomatikong na-a-update ang loyalty points at record niya.</li>
  </ul>`
},
{
  id: 'pos-promo-code',
  category: 'POS Terminal',
  question: 'Paano gamitin ang promo code sa POS Terminal?',
  keywords: ['promo code', 'discount code', 'coupon', 'promocode'],
  answer: `<p>Sa cart ng POS Terminal, ilagay lang ang promo code sa provided na field. Awtomatikong che-check ng system kung:</p>
  <ul>
    <li><strong>Active</strong> pa ang code (hindi disabled)</li>
    <li>Hindi pa <strong>na-expire</strong> (kung may takdang petsa)</li>
    <li>Naabot na ng subtotal ang <strong>minimum spend</strong> kung meron</li>
  </ul>
  <p>Ang discount ay puwedeng nasa <strong>percent</strong> o <strong>fixed na halaga</strong> — hindi ito lalagpas sa kabuuang halaga ng bibilhin. Kahit sinong naka-login ay pwedeng gumamit ng valid promo code sa checkout — ang paggawa/pag-edit lang ng promo codes ang kailangan ng espesyal na access.</p>`
},
{
  id: 'pos-customer-loyalty',
  category: 'POS Terminal',
  question: 'Paano gumagana ang Customer Loyalty Points?',
  keywords: ['loyalty points', 'customer points', 'rewards', 'redeem points', 'select customer'],
  answer: `<p>Sa POS Terminal, may "Select Customer" option para i-attach ang isang registered customer sa transaksyon. Kapag na-checkout:</p>
  <ul>
    <li>Kumikita ang customer ng <strong>1 point kada ₱100</strong> ng benta.</li>
    <li>Kung may pini-redeem na points ang customer, ibinabawas muna ito bago idagdag ang bagong kinita.</li>
    <li>Awtomatikong na-a-update ang record ng customer (total na nagastos at bilang ng bisita).</li>
    <li>Makikita agad sa resibo ang points na kinita at ang bagong balance.</li>
  </ul>`
},
{
  id: 'pos-split-payment',
  category: 'POS Terminal',
  question: 'Puwede bang gumamit ng dalawang payment method sa isang benta?',
  keywords: ['split payment', 'dalawang payment', 'cash and gcash', 'multiple payment method'],
  verdict: 'oo',
  answer: `<p>Oo — sinusuportahan ang <strong>split o maraming payment method</strong> sa iisang transaksyon (hal. bahagi Cash, bahagi GCash). Awtomatikong tama pa rin ang pagbilang ng cash sa Z-Reading dahil hiwalay itong itinatala kada payment method.</p>`
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
  <p><strong>Note:</strong> Kung itinakda ng Admin na kailangan muna ng approval para sa role mo, papasok muna ang pagbabago sa <strong>Staff Requests</strong> — hindi agad naa-apply hanggang sa i-approve ito.</p>`
},
{
  id: 'inv-import-export',
  category: 'Inventory',
  question: 'Paano mag-import o mag-export ng products (Excel/CSV)?',
  keywords: ['import products', 'export products', 'excel template', 'csv', 'bulk upload', 'maramihang produkto'],
  answer: `<p><strong>Import:</strong> pumunta sa Products page, i-download muna ang <strong>Excel template</strong> para sigurado ang tamang column format, punan ito, tapos i-upload. May file size limit (10MB) para sa upload.</p>
  <p><strong>Export:</strong> may button para i-download ang kasalukuyang inventory bilang CSV file (Code, Name, Category, Price, Stock, Supplier, Expiry Date, Low Stock Threshold, Cost Price).</p>`
},
{
  id: 'inv-barcode',
  category: 'Inventory',
  question: 'Paano gumawa o mag-print ng barcode?',
  keywords: ['barcode', 'print barcode', 'generate barcode', 'scan produkto'],
  answer: `<p>Pumunta sa <strong>Inventory → Barcode</strong>. Doon mo makikita ang barcode ng bawat produkto batay sa product code, na puwedeng i-print para gamitin sa pag-scan tuwing may benta sa POS Terminal (gamit man ang camera scanner o hardware barcode scanner).</p>`
},
{
  id: 'inv-low-stock',
  category: 'Inventory',
  question: 'Paano malalaman kung anong produkto na ang mababa na ang stock?',
  keywords: ['low stock', 'mababang stock', 'out of stock', 'reorder alert', 'lowstock'],
  answer: `<p>May <strong>Reorder Alerts</strong> page na nagpapakita ng lahat ng produktong bumaba na sa kanilang Low Stock Threshold, kasama ang ilang araw na itong naka-flag bilang low o out-of-stock (awtomatikong nawawala ito sa listahan kapag na-restock na).</p>
  <p>Mula rito, puwede kang:</p>
  <ul>
    <li><strong>Quick Restock</strong> — direktang magdagdag ng stock</li>
    <li>Gumawa ng <strong>Purchase Order</strong> per-supplier para sa mas maayos na tracking ng pag-order</li>
  </ul>`
},
{
  id: 'inv-purchase-order',
  category: 'Inventory',
  question: 'Paano gumagana ang Purchase Orders?',
  keywords: ['purchase order', 'po', 'order sa supplier', 'receive order', 'cancel order'],
  answer: `<p>Sa Reorder Alerts / Purchase Orders page, puwede kang gumawa ng Purchase Order per supplier — piliin ang mga item at quantity na iaayos.</p>
  <ul>
    <li><strong>Receive:</strong> kapag dumating na ang order, i-click ang "Receive" — <strong>awtomatikong idadagdag sa stock</strong> ang lahat ng items dito.</li>
    <li><strong>Cancel:</strong> kung hindi natuloy ang order, i-cancel na lang (hindi na maaapply pa sa stock).</li>
  </ul>`
},

// ------------------------------------------------------------------
// 6. TRANSACTIONS / VOID
// ------------------------------------------------------------------
{
  id: 'tx-view',
  category: 'Transactions',
  question: 'Saan ko makikita ang lahat ng naibentang transaksyon?',
  keywords: ['view transactions', 'transaction history', 'listahan ng benta', 'sales history'],
  answer: `<p>Sa <strong>Transactions</strong> tab. Default, makikita mo lang ang <strong>sarili mong</strong> mga transaksyon (bilang cashier). Kung binigyan ka ng Admin ng access para makita ang lahat, makikita mo na ang transaksyon ng LAHAT ng cashier.</p>`
},
{
  id: 'tx-void',
  category: 'Transactions',
  question: 'Paano ma-void o makansela ang isang transaction?',
  keywords: ['void transaction', 'kanselahin', 'cancel transaction', 'undo sale', 'refund'],
  answer: `<p>Sa <strong>Transactions</strong>, hanapin ang order na gustong i-void, tapos i-click ang void option. Hihingan ka ng <strong>Admin password</strong> bago matuloy:</p>
  <ol>
    <li>Kapag tama ang admin password, <strong>awtomatikong ibabalik ang stock</strong> ng lahat ng items sa transaksyon papunta sa imbentaryo.</li>
    <li>Aalisin ang transaksyon sa listahan, pero <strong>naka-log pa rin</strong> ang buong detalye para sa audit trail at para ma-tally sa Z-Reading.</li>
  </ol>
  <p><strong>Note:</strong> Limitado lang ang maling attempt ng admin password (8 beses bawat 10 minuto) para sa proteksyon.</p>`
},

// ------------------------------------------------------------------
// 7. SHIFT / Z-READING
// ------------------------------------------------------------------
{
  id: 'shift-what',
  category: 'Shift / Z-Reading',
  question: 'Ano ang Shift / Z-Reading?',
  keywords: ['shift', 'z-reading', 'zreading', 'end of day report', 'cash count'],
  answer: `<p>Ang "Shift" ay ang panahon mula sa <strong>huling pagsara</strong> ng shift ng isang cashier hanggang ngayon. <strong>Per-cashier</strong> ito — bawat cashier, kahit anong terminal ang gamit niya, ay may sarili at hiwalay na open shift.</p>
  <p>Ang Z-Reading ay ang <strong>closing report</strong> na naglalaman ng: bilang ng transaksyon, gross sales, total discount, net sales, breakdown per payment method, bilang/halaga ng void, at <strong>cash variance</strong> (short/over) base sa binilang na cash sa drawer.</p>`
},
{
  id: 'shift-open',
  category: 'Shift / Z-Reading',
  question: 'Paano magbukas ng shift (Beginning Cash Float)?',
  keywords: ['beginning cash', 'open shift', 'simulan ang shift', 'starting cash'],
  answer: `<p>Sa unang pagbubukas ng POS Terminal sa loob ng bagong shift, ipapapasok sa iyo ang <strong>Beginning Cash Float</strong> — ang halagang laman ng cash drawer bago magsimulang magbenta.</p>
  <p>Hindi na ito mababago pagkatapos i-set, hanggang sa susunod mong isara ang sarili mong shift.</p>`
},
{
  id: 'shift-close',
  category: 'Shift / Z-Reading',
  question: 'Paano isara ang shift / mag-Z-Reading?',
  keywords: ['close shift', 'isara ang shift', 'end shift', 'ending cash'],
  answer: `<p>Sa Shift/Z-Reading tab, i-click ang "Close Shift". Ilalagay mo ang <strong>Ending Cash Counted</strong> (aktwal na binilang na laman ng drawer). Awtomatikong kina-calculate ng system:</p>
  <ul>
    <li><strong>Expected Cash</strong> = Beginning Cash + Cash-method sales</li>
    <li><strong>Cash Variance</strong> = Ending Cash Counted − Expected Cash (negative = <strong>SHORT/kulang</strong>, positive = <strong>OVER/sobra</strong>)</li>
  </ul>
  <p>Hindi puwedeng mag-close kung walang bagong transaksyon o void mula sa huling pagsara. Pagkatapos mag-close, kailangan mo nang mag-set ulit ng bagong Beginning Cash sa susunod mong pagbukas ng terminal.</p>`
},
{
  id: 'shift-supervisor-control',
  category: 'Shift / Z-Reading',
  question: 'Puwede bang isara ng Admin ang shift ng ibang cashier?',
  keywords: ['close other cashier shift', 'supervisor control', 'admin close shift ng iba'],
  verdict: 'depende',
  answer: `<p>Oo, kung binigyan ng Admin ang role mo ng ganitong access. Makikita ng Admin/Supervisor ang listahan ng lahat ng cashier na may kasalukuyang <strong>bukas</strong> na shift, at puwedeng piliin at isara ang shift nila — kahit ibang terminal pa ang pinagbuksan nito.</p>
  <p>Ordinaryong Cashier/Staff (walang ganitong access) ay makakapag-close lang ng <strong>sarili nilang</strong> shift.</p>`
},
{
  id: 'shift-cashier-hidden-amounts',
  category: 'Shift / Z-Reading',
  question: 'Bakit hindi ko makita ang Gross Sales/Net Sales bilang Cashier?',
  keywords: ['hindi makita sales amount', 'hidden peso amount', 'gross sales hindi lumalabas'],
  answer: `<p>Sinasadya ito ng Admin para sa privacy ng peso figures — naka-OFF ito by default para sa Cashier role, pero makikita pa rin nila ang bilang ng transaksyon at breakdown per payment method (kailangan pa rin nila para sa cash counting/Z-Reading close nila).</p>
  <p>Kung kailangan mong makita ito, maaari itong hilingin sa Admin na buksan para sa role mo.</p>`
},

// ------------------------------------------------------------------
// 8. REPORTS
// ------------------------------------------------------------------
{
  id: 'reports-sales',
  category: 'Reports',
  question: 'Saan ko makikita ang kabuuang benta at pinaka-bestseller na produkto?',
  keywords: ['sales report', 'kabuuang benta', 'bestseller', 'top selling', 'gross income'],
  answer: `<p>Sa <strong>Sales Report</strong> makikita ang gross income, bilang ng transaksyon, at ranking ng top-selling na produkto — laging updated ito base sa aktwal na naitalang benta.</p>`
},
{
  id: 'reports-user-logs',
  category: 'Reports',
  question: 'Ano ang makikita sa User Logs?',
  keywords: ['user logs', 'audit trail', 'activity log', 'history ng aksyon'],
  answer: `<p>Ipinapakita rito ang history ng mga aksyon ng bawat user sa system — kung sino ang naglogin, nagbenta, nag-void, nag-approve/reject ng request, gumawa ng purchase order, atbp. — para sa accountability at audit trail. Karaniwan, Admin lang ang may access dito maliban kung binigyan ng access ang ibang role.</p>`
},

// ------------------------------------------------------------------
// 9. CUSTOMERS
// ------------------------------------------------------------------
{
  id: 'customers-add',
  category: 'Customers',
  question: 'Paano magdagdag ng customer profile?',
  keywords: ['add customer', 'customer profile', 'bagong customer', 'register customer'],
  answer: `<p>Sa <strong>Customers</strong> tab, i-click ang Add Customer at punan ang detalye (pangalan, contact, email). Puwede ka ring mag-search ng existing customer.</p>`
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
  <p><strong>May 2 LIBRENG pag-customize</strong> (hindi kasama ang Paper Size dahil hardware setting lang ito). Pagkatapos maubos ang 2 free attempts, kailangan na ng <strong>OTP (One-Time Password/Code) verification</strong> bago makapag-save ng bagong pagbabago.</p>`
},
{
  id: 'receipt-gmail-app-password',
  category: 'Receipt Settings',
  question: 'Bakit kailangan ng Gmail App Password sa Receipt Settings?',
  keywords: ['gmail app password', 'otp sender', 'why gmail password', 'app password setup'],
  answer: `<p>Ginagamit ang Gmail account (kasama ang <strong>App Password</strong> nito — hindi ang personal na password) para awtomatikong makapagpadala ng OTP email tuwing kailangan ng verification (receipt customization pagkatapos ng 2 free attempts, Pro theme unlock, o factory reset backup).</p>
  <p><strong>Note sa seguridad:</strong> Ang App Password ay hindi kailanman ipinapakita pabalik sa iyo — ipinapakita lang ang parte ng naka-configure na email (hal. ma***@gmail.com) para lang ma-confirm na tama ang naka-save.</p>`
},
{
  id: 'receipt-otp-flow',
  category: 'Receipt Settings',
  question: 'Paano gumagana ang OTP (One-Time Password/Code) verification?',
  keywords: ['otp', 'one time password', 'one time code', 'verification code'],
  answer: `<p>Ang <strong>OTP</strong> ay isang 6-digit na random code na:</p>
  <ol>
    <li>Kapag hiniling (hal. Receipt Customization pagkatapos ng 2 free attempts), gumagawa ng bagong code na valid lang sa loob ng <strong>10 minuto</strong>.</li>
    <li>Ipinapadala ito sa <strong>naka-registered na email ng may-ari/developer ng system</strong> — hindi sa user na humihiling.</li>
    <li>Ilagay mo ang code na natanggap para "ma-unlock" ang aksyon (save receipt settings, unlock Pro theme, atbp.).</li>
    <li>Isang beses lang magagamit ang code, at automatic itong nag-e-expire pagkatapos ng 10 minuto.</li>
  </ol>`
},
{
  id: 'themes-pro',
  category: 'Themes',
  question: 'Paano mag-unlock ng Pro Theme (Ocean, Emerald, Sunset, Rose Gold)?',
  keywords: ['pro theme', 'unlock theme', 'ocean pro', 'emerald pro', 'sunset pro', 'rosegold', 'bayad theme'],
  answer: `<p>Sa Themes menu, may 4 na Pro Theme (₱149 each): Ocean Pro, Emerald Pro, Sunset Pro, Rose Gold Pro.</p>
  <ol>
    <li>Mag-request ng unlock — magpapadala ito ng OTP sa email ng may-ari/developer ng system.</li>
    <li>Kapag na-confirm ang OTP, naka-unlock na permanently ang theme na iyon para sa system mo.</li>
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
  answer: `<p>Walang hiwalay na "forgot password" na self-service form ang OmniPOS — ang paraan para makabalik ay ang <strong>System Reset (Hard Factory Reset)</strong>, na kailangang naka-setup na muna ang Gmail App Password sa Receipt Settings bago magamit.</p>
  <p>Kapag ginamit ang Hard Reset: ipapadala muna ang <strong>buong backup</strong> ng data sa email mo bago burahin ang data, tapos ibabalik ang mga user account sa <strong>default set</strong> ng mga account.</p>
  <p><strong>Mahalagang paalala:</strong> Kailangan mo munang naka-access ang isang Admin account (kahit anong Admin) para ma-trigger ang Hard Reset.</p>`
},
{
  id: 'system-reset-full',
  category: 'System Reset',
  question: 'Ano ang mangyayari kapag ginawa ang System Reset / Factory Reset?',
  keywords: ['factory reset', 'system reset', 'hard reset', 'clear all data', 'burahin lahat ng data'],
  answer: `<p>Ang <strong>Hard Factory Reset</strong> ay ADMIN-ONLY na aksyon, at ito ang sunud-sunod na mangyayari:</p>
  <ol>
    <li>Kokolektahin ang <strong>KUMPLETONG backup</strong> ng lahat ng data (users, products, transactions, logs, requests, categories, customers, shifts, atbp.).</li>
    <li>Ipapadala muna ang backup na ito sa email mo — <strong>kung mag-fail ang email</strong> (hal. maling app password), <strong>ihihinto ang buong reset</strong> at LIGTAS pa rin ang data.</li>
    <li>Kapag successful ang email, saka lang isasagawa ang pagbura: babalik ang users sa default set of accounts, mabubura ang products/transactions/requests/customers/shifts/logs, at babalik sa default categories.</li>
  </ol>
  <p><strong>Sinasadyang HINDI ginagalaw:</strong> ang bilang ng LIBRENG pag-customize ng resibo — para hindi magamit ang Factory Reset para lang maibalik ang 2 free attempts.</p>`
},
{
  id: 'system-restore-backup',
  category: 'System Reset',
  question: 'Paano mag-restore mula sa backup file?',
  keywords: ['restore backup', 'ibalik ang backup', 'import backup file', 'recover data'],
  answer: `<p>Sa Restore Backup feature, kailangan ang Admin username, password, at ang backup file (galing sa dating Factory Reset email o manual export). Kapag na-verify ang admin credentials, ise-synchronize ang lahat ng data (users, products, transactions, user logs, requests, categories, carts) mula sa laman ng backup file na iyon.</p>`
},

// ------------------------------------------------------------------
// 12. STAFF REQUESTS / APPROVAL WORKFLOW
// ------------------------------------------------------------------
{
  id: 'requests-approval',
  category: 'Staff Requests',
  question: 'Ano ang Staff Requests at paano ito ina-approve?',
  keywords: ['staff requests', 'pending approval', 'approve reject', 'request approval'],
  answer: `<p>Kapag itinakda ng Admin na kailangan muna ng approval para sa isang role (hal. sa pagdagdag ng produkto, pag-restock, o pag-edit ng sariling profile), ang mga aksyong ito ay <strong>hindi agad naa-apply</strong>. Sa halip, pumapasok ito sa <strong>Staff Requests</strong> bilang PENDING.</p>
  <p>Ang Admin lang ang makaka-approve o makaka-reject nito. Kapag na-approve, saka lang aktwal na maa-apply ang pagbabago, at naka-log ang buong desisyon (kasama kung sino ang nag-approve/reject).</p>`
},

// ------------------------------------------------------------------
// 13. SECURITY / DATA INTEGRITY
// ------------------------------------------------------------------
{
  id: 'security-overview',
  category: 'Security',
  question: 'Anong mga proteksyon meron ang OmniPOS para sa data at accounts?',
  keywords: ['security', 'seguridad', 'proteksyon', 'ligtas ba ang data', 'safe ba'],
  verdict: 'oo',
  answer: `<p>Ilan sa mga built-in na proteksyon ng OmniPOS:</p>
  <ul>
    <li><strong>Naka-encrypt ang mga password</strong> — hindi ito naka-imbak sa plain/nababasang anyo.</li>
    <li><strong>Kailangan ng valid login</strong> bago magamit ang anumang parte ng system — walang direktang access na hindi dumadaan sa login.</li>
    <li><strong>May limitasyon sa maling attempt</strong> (login, void, password reset, OTP, factory reset) — para maiwasan ang paulit-ulit na paghula ng password o code.</li>
    <li><strong>Access ayon sa role</strong> — sinusunod ito kahit saan sa system, hindi lang sa itsura ng menu.</li>
    <li><strong>Kailangan ng Admin password</strong> para sa mapanganib na aksyon tulad ng pag-void ng transaction at pag-restore ng backup.</li>
    <li>Limitado ang laki ng file na puwedeng i-upload, para hindi ma-abuso ang system.</li>
  </ul>`
},
{
  id: 'security-database',
  category: 'Security',
  question: 'Saan naka-store ang data ng OmniPOS?',
  keywords: ['saan naka store data', 'database file', 'omnipos.db'],
  answer: `<p>Ligtas at maayos na naka-imbak ang lahat ng datos (users, products, transactions, logs, requests, categories, customers, promo codes, shifts, purchase orders, atbp.) sa iisang lugar sa loob ng system. Kaya naman simple lang ang paggawa ng backup — iisang file lang ang kailangang i-save.</p>`
},

// ------------------------------------------------------------------
// 14. SYSTEM UPDATE
// ------------------------------------------------------------------
{
  id: 'system-update-check',
  category: 'System Updates',
  question: 'Paano ko malalaman kung may bagong bersyon ng OmniPOS at paano ito i-update?',
  keywords: ['check update', 'check for updates', 'bagong bersyon', 'paano mag update', 'update ng system', 'may update ba', 'i-update ang omnipos', 'deploy update', 'new version'],
  answer: `<p>Pumunta sa <strong>Settings → System Update</strong> (Admin access lang). Doon:</p>
  <ol>
    <li>Pindutin ang <strong>"Check for Updates"</strong> para malaman kung may bagong bersyon na ng OmniPOS na available — makikita rito ang kasalukuyang bersyon mo at ang pinakabagong bersyon.</li>
    <li>Kung may bagong bersyon, lalabas ang button na <strong>"Deploy Update Now"</strong> — pindutin ito para awtomatikong ma-apply ang update sa system mo.</li>
  </ol>
  <p><strong>Note:</strong> Ligtas ang proseso ng pag-update — hindi mawawala ang mga datos mo (products, transactions, users, atbp.) sa panahon ng pag-update.</p>`
},
{
  id: 'update-latest-changes',
  category: 'System Updates',
  question: 'Ano ang mga bagong update o pagbabago sa OmniPOS?',
  keywords: ['bago', 'update', 'updates', 'changelog', 'ano ang bago', 'whats new', "what's new", 'latest changes', 'nabago sa system', 'recent changes', 'bagong feature', 'anong nabago'],
  answer: `<p>Narito ang mga pinakabagong pagbabago sa interface ng OmniPOS:</p>
  <ul>
    <li><strong>Mas maayos na Profile menu:</strong> ang dropdown ng user profile (sa itaas ng sidebar) ay awtomatikong nagsasara na ngayon kapag may ibang menu na binuksan, kapag pinindot ang labas nito, o kapag nag-scroll — para hindi na ito magpatong-patong sa ibang dropdown.</li>
    <li><strong>Hindi na lumalabas sa gilid ang Profile dropdown:</strong> limitado na ang taas nito batay sa laki ng screen, kaya kung mahaba ang listahan (hal. maraming Active Users), sa loob na lang ng dropdown mismo ito nag-iscroll sa halip na tumagilid palabas.</li>
    <li><strong>Page title na lumilipat sa Header sa Tablet/Cellphone:</strong> kapag ginagamit ang system sa tablet o cellphone, ang pamagat ng bawat pahina (hal. Dashboard, Products, FAQ) ay ipinapakita na ngayon sa itaas na Header — malapit sa notification bell — sa halip na sa loob ng page mismo, para mas maluwag ang tingin sa maliit na screen.</li>
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
    <li>Kapag binuksan ang isa pang menu/dropdown, awtomatikong isinasara muna ang ibang bukas na dropdown — iisa lang na dropdown ang bukas sa anumang oras.</li>
    <li>Kapag pinindot ang kahit saan sa labas ng dropdown, o kapag lumipat ng ibang page/view, isinasara agad ito.</li>
    <li>Kapag mag-scroll habang bukas ang dropdown, isinasara din agad ito.</li>
    <li>Limitado na rin ang pinakamataas na taas ng dropdown batay sa laki ng screen, kaya hindi na ito "lumalabas" ng sidebar kapag mahaba ang laman — sa loob na lang ng dropdown mismo ito nag-iscroll.</li>
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
    <li><strong>Sa Tablet o Cellphone</strong> (maliit na screen), inililipat ang pamagat ng kasalukuyang pahina — hal. <em>Dashboard, Products, Barcode Generator, Reorder Alerts, Sales Analytics, Transaction, Customers, Shift/Z-Reading, System Audit Logs, FAQ</em> — papunta sa itaas na Header, katabi lang (bago) ng notification bell, sa halip na sa loob ng page mismo, para mas maluwag ang tingin sa maliit na screen.</li>
    <li><strong>Sa PC o Laptop</strong> (malaking screen), nananatili ang bawat pamagat sa ORIHINAL nitong pwesto — sa loob ng page/view mismo, hindi sa Header — gaya ng dati.</li>
  </ul>
  <p>Awtomatiko itong nag-aadjust din kapag binago ang laki ng browser window o kapag i-rotate ang tablet/cellphone (portrait/landscape).</p>`
},

];
