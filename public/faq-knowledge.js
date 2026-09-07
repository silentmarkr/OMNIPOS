

window.OMNIPOS_FAQ_KB_TL = [

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
  <p>Ang mga sumusunod lang ang <strong>nangangailangan ng aktibong internet connection</strong>:</p>
  <ul>
    <li>Pagpapadala ng email receipt sa customer</li>
    <li>OTP (One-Time Password/Code) verification — para sa Receipt Customization, Pro Theme/Premium Feature unlock, Demo Mode, Factory Reset backup, at pag-reset ng nakalimutang Admin password</li>
    <li>AI Bulk Image Search — ang awtomatikong paghahanap ng litrato para sa mga produkto</li>
    <li>Cloud Backup at Multi-Branch Dashboard — ang pag-sync ng data papunta sa online storage o sa ibang branch</li>
  </ul>`
},
{
  id: 'overview-lan-qr-access',
  category: 'Overview',
  question: 'Paano buksan ang OmniPOS gamit ang QR code sa ibang device (LAN)?',
  keywords: ['qr code open device', 'scan para makapasok', 'server ip qr', 'ibang device lan', 'connect ibang cellphone'],
  answer: `<p>Kapag naka-LAN mode ang system (parehong network/WiFi ang mga device), may available na <strong>"Server IP QR Code"</strong> na makikita sa system — nagpapakita ito ng QR code na naka-encode sa network address ng server.</p>
  <p>I-scan lang ito gamit ang camera o QR scanner ng ibang device (basta pareho ang WiFi/LAN) para direktang mabuksan ang OmniPOS doon, nang hindi na kailangang i-type nang manu-mano ang IP address.</p>`
},

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
{
  id: 'login-biometric',
  category: 'Login & Sessions',
  question: 'Paano mag-enable ng Fingerprint/Biometric Login?',
  keywords: ['fingerprint login', 'biometric login', 'webauthn', 'face id', 'passkey', 'walang password login', 'touch id'],
  answer: `<p>Ang <strong>Fingerprint Login</strong> (gamit ang WebAuthn — fingerprint, Face ID, o PIN ng device) ay opsyonal na paraan para mag-login nang hindi na kailangang i-type ang password sa parehong device.</p>
  <ol>
    <li>Mag-login muna gamit ang normal na username/password.</li>
    <li>Sa profile settings, i-click ang opsyong i-enable ang Fingerprint Login sa device na ginagamit — susundin nito ang built-in na fingerprint/Face ID/PIN ng iyong phone, tablet, o laptop.</li>
    <li>Sa susunod na pagbukas ng Login page sa parehong device, lalabas na ang opsyong "Login with Fingerprint" — pindutin ito sa halip na mag-type ng password.</li>
  </ol>
  <p>Bawat na-enable na device ay may sariling listahan sa profile settings, at puwede itong tanggalin (remove) nang isa-isa kung gusto mong i-disable ito sa isang partikular na device.</p>`
},

{
  id: 'roles-permission-matrix',
  category: 'Roles & Permissions',
  question: 'Paano gumagana ang Roles at Permissions?',
  keywords: ['roles', 'permissions', 'permission matrix', 'access control', 'menu access', 'sino pwede'],
  answer: `<p>Ang Admin ang nagtatakda kung anong menu o feature ang makikita/magagamit ng bawat role (Admin, Staff, Cashier, o custom na role) sa pamamagitan ng <strong>Permission Matrix</strong> sa Settings tab — hindi na kailangan mag-request ng developer para baguhin ito.</p>
  <p>Ngayon, mas detalyado (granular) na ang matrix — bukod sa anong menu ang makikita ng isang role, maaari na ring itakda nang hiwalay kung anong partikular na AKSYON ang pwede nitong gawin (hal. mag-void, mag-refund, mag-authorize ng manual discount), at kung kailangan pa ito ng approval ng Admin o hindi.</p>
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
  id: 'roles-own-password',
  category: 'Roles & Permissions',
  question: 'Puwede bang mag-authorize ang isang Supervisor/Staff gamit ang sarili nilang password sa halip na hanapin ang Admin?',
  keywords: ['sariling password', 'own password', 'supervisor password', 'hindi admin password', 'authorize without admin'],
  verdict: 'oo',
  answer: `<p>Oo — para sa mga sensitibong aksyon (Void, Refund, Manual Discount, manual na Loyalty Points redemption, at pagsasara ng shift ng ibang cashier), default na kailangan ang Admin password. Kung nais ng Admin na bigyan ang isang role (hal. Supervisor) ng kakayahang mag-authorize gamit na lang ang <strong>sarili nilang password</strong> sa halip na hanapin pa ang Admin, maaari itong i-on nang hiwalay kada aksyon sa Permission Matrix.</p>
  <p>Walang epekto ito sa ibang aksyon na hindi naka-toggle — kada aksyon ay may sarili itong on/off switch.</p>`
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
  id: 'pos-manual-discount',
  category: 'POS Terminal',
  question: 'Paano magbigay ng manual discount na walang promo code?',
  keywords: ['manual discount', 'discount hindi promo code', 'bawasan ang presyo', 'special discount', 'custom discount'],
  answer: `<p>Bukod sa Promo Code, may hiwalay na field sa cart summary — <strong>"Discount"</strong> — kung saan puwede kang maglagay ng kahit anong halaga bilang discount nang direkta, hal. para sa isang special na kasunduan sa isang customer na wala namang promo code.</p>
  <ul>
    <li>Hindi ito lalagpas sa kabuuang halaga ng bibilhin.</li>
    <li>Hihingan ka ng Admin/Supervisor password bago matuloy ang Charge, maliban na lang kung binigyan ka ng Admin ng access na gamitin ang sarili mong password.</li>
    <li>Ang buong detalye ng manual discount, kasama kung sino ang nag-authorize nito, ay naitatala sa audit log ng transaksyon.</li>
  </ul>`
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
{
  id: 'pos-bluetooth-printer',
  category: 'POS Terminal',
  question: 'Paano gamitin ang Bluetooth printer sa POS Terminal?',
  keywords: ['bluetooth printer', 'wireless printer', 'thermal printer bluetooth', 'cash drawer bluetooth', 'i-connect printer'],
  answer: `<p>Sinusuportahan ang pag-print ng resibo at pagbukas ng cash drawer sa pamamagitan ng <strong>Bluetooth thermal printer</strong> — kapag napili ang "Bluetooth" bilang paraan ng pag-print sa settings, dumidiretso na ang resibo sa naka-pair na Bluetooth printer sa halip na ipakita lang sa screen o i-print gamit ang regular na browser print.</p>
  <p>Kung may compatible na Bluetooth cash drawer naman na naka-konekta sa printer, awtomatiko rin itong bubuksan sa tuwing may bagong benta/refund na naka-cash.</p>`
},

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
    <li><strong>Quick Restock</strong> — mabilisang magdagdag ng stock</li>
    <li>Gumawa ng <strong>Purchase Order</strong> per-supplier para sa mas maayos na tracking ng pag-order</li>
  </ul>`
},
{
  id: 'inv-quick-restock',
  category: 'Inventory',
  question: 'Ano ang Quick Restock at paano ito gamitin?',
  keywords: ['quick restock', 'mabilisang restock', 'dagdag stock', 'add stock fast', 'restock nang mabilis'],
  answer: `<p>Ang <strong>Quick Restock</strong> ay para sa mabilisang pagdagdag ng stock nang hindi na kailangang gumawa ng buong Purchase Order — hal. bumili ka lang ng ilang piraso sa palengke o sari-sari store.</p>
  <ol>
    <li>Sa Reorder Alerts, hanapin ang produktong gustong dagdagan ng stock, tapos i-click ang Quick Restock button sa tabi nito.</li>
    <li>Ilagay ang bilang na idadagdag, tapos kumpirmahin.</li>
  </ol>
  <p>Kung binigyan ka ng Admin ng access na "direct apply", agad na maidadagdag ito sa stock. Kung hindi, papasok muna ito sa Staff Requests bilang PENDING hanggang sa i-approve ng Admin.</p>`
},
{
  id: 'inv-bulk-image-search',
  category: 'Inventory',
  question: 'May paraan bang awtomatikong makahanap ng litrato para sa maraming produkto nang sabay-sabay?',
  keywords: ['bulk image search', 'ai photo search', 'awtomatikong litrato', 'search images produkto', 'maramihang larawan', 'product photo search'],
  answer: `<p>Oo — gamitin ang <strong>Bulk Search Images</strong> na tool sa Products page. Awtomatiko itong maghahanap ng litrato online para sa bawat produkto (base sa pangalan) at magmumungkahi ng pinakaakmang larawan — wala munang na-a-apply hanggang hindi mo pinipili.</p>
  <ol>
    <li>Buksan ang Bulk Search Images, piliin kung "mga produktong walang larawan pa lang" ang gagawan, at itakda ang bilang ng produktong pagpoprosesuhin sa isang takbo.</li>
    <li>Simulan ang paghahanap — makikita ang progress habang isinasagawa.</li>
    <li>Tingnan ang mga imungkahing larawan — i-untick ang mga mali o hindi angkop.</li>
    <li>I-apply para i-save ang mga napiling litrato sa kani-kanilang produkto.</li>
  </ol>
  <p><strong>Note:</strong> Kailangan ito ng internet connection, at may limitasyon (quota) sa bilang na maprosesong produkto kada takbo — puwede lang itong ulitin para sa natitira.</p>`
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
  keywords: ['void transaction', 'kanselahin', 'cancel transaction', 'undo sale'],
  answer: `<p>Sa <strong>Transactions</strong>, hanapin ang order na gustong i-void, tapos i-click ang void option. Hihingan ka ng <strong>Admin password</strong> (o sariling password mo, kung binigyan ka ng Admin ng ganitong access) bago matuloy:</p>
  <ol>
    <li>Kapag tama ang password, <strong>awtomatikong ibabalik ang stock</strong> ng lahat ng items sa transaksyon papunta sa imbentaryo.</li>
    <li>Aalisin ang transaksyon sa listahan, pero <strong>naka-log pa rin</strong> ang buong detalye para sa audit trail at para ma-tally sa Z-Reading.</li>
  </ol>
  <p><strong>Note:</strong> Limitado lang ang maling attempt ng password (8 beses bawat 10 minuto) para sa proteksyon. Hindi mo na rin puwedeng i-void ang isang transaksyon kung may nairekord na itong refund — gamitin na lang ang Refund para sa natitirang balanse.</p>`
},
{
  id: 'tx-refund',
  category: 'Transactions',
  question: 'Paano mag-refund ng isang transaction (buo o bahagi lang)?',
  keywords: ['refund', 'i-refund', 'partial refund', 'full refund', 'ibalik ang bayad', 'money back', 'sauli ng bayad'],
  answer: `<p>Bukod sa Void (na kumakansela sa BUONG transaksyon), maaari ka nang mag-proseso ng <strong>Refund</strong> — ibinabalik ang bayad ng customer, buo man o bahagi lamang, nang hindi kinakansela ang buong transaksyon.</p>
  <ol>
    <li>Sa Transactions, hanapin ang transaksyong gustong i-refund, tapos i-click ang opsyong Refund.</li>
    <li>Piliin kung anong item(s) at ilang piraso (quantity) ang irerefund — maaaring buo o bahagi lamang ng bawat linya.</li>
    <li>Maglagay ng dahilan (reason) para sa refund.</li>
    <li>Ilagay ang Admin password, o sariling password mo kung binigyan ka ng ganitong access.</li>
    <li>Kapag na-kumpirma, awtomatikong ibabalik sa stock ang mga na-refund na item.</li>
  </ol>
  <p>Puwede mong gawin nang paulit-ulit ang partial refund sa parehong transaksyon (hal. isang item ngayon, isa pa mamaya), hanggang sa maabot ang buong halaga ng orihinal na benta. Ang bilang at halaga ng mga refund ay makikita rin sa Z-Reading at sa Sales Analytics.</p>`
},

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

{
  id: 'customers-add',
  category: 'Customers',
  question: 'Paano magdagdag ng customer profile?',
  keywords: ['add customer', 'customer profile', 'bagong customer', 'register customer'],
  answer: `<p>Sa <strong>Customers</strong> tab, i-click ang Add Customer at punan ang detalye (pangalan, contact, email). Puwede ka ring mag-search ng existing customer.</p>`
},
{
  id: 'customers-loyalty-card',
  category: 'Customers',
  question: 'Paano mag-issue ng Loyalty Card o QR para sa isang customer?',
  keywords: ['loyalty card', 'loyalty qr', 'issue card', 'regenerate card', 'card scan customer', 'lost loyalty card'],
  answer: `<p>Ang bawat customer ay maaaring bigyan ng sariling <strong>Loyalty Card o QR</strong> — ito ang isi-scan sa POS Terminal para awtomatikong ma-attach ang customer at ma-pre-authorize ang kanilang points redemption nang walang password na kailangan.</p>
  <p>Dalawang uri:</p>
  <ul>
    <li><strong>Static Card</strong> — permanenteng QR/barcode na maaaring i-print at ilagay sa isang pisikal na card.</li>
    <li><strong>Rotating QR</strong> — nagpapalit-palit ang QR code paminsan-minsan (hal. ipinapakita sa telepono ng customer) para sa dagdag na seguridad laban sa pagkopya.</li>
  </ul>
  <p>Kapag na-regenerate ang card ng isang customer, awtomatikong nade-deactivate ang dating QR — ang bago na lang ang gagana. Maaari ring i-revoke (kanselahin) ang isang card kung nawala o na-abuso. Ang pag-issue/regenerate ay nangangailangan ng espesyal na access — hindi lahat ng role ay awtomatikong may ganitong kakayahan.</p>`
},
{
  id: 'customers-debtors',
  category: 'Customers',
  question: 'Ano ang Debtors at paano ito ginagamit?',
  keywords: ['debtors', 'utang', 'utang ng customer', 'debtors ledger', 'due date utang', 'bayaran ng customer'],
  answer: `<p>Ang <strong>Debtors</strong> ay isang ledger na sumusubaybay sa mga customer na may <strong>utang</strong> (hal. pautang na benta) — kasama ang halaga, petsa ng benta, at due date.</p>
  <ul>
    <li>Makikita rito ang lahat ng may aktibong utang, at kung sino ang lagpas na sa due date.</li>
    <li>Puwedeng magtala ng bayad (buo o bahagi lang) laban sa isang utang, at awtomatikong nagba-bawas ito sa natitirang balanse.</li>
    <li>Bahagi ito ng Customer Profiles, Loyalty & Debtors premium module — kasabay na naka-unlock kapag nabili ito.</li>
  </ul>`
},

{
  id: 'receipt-customize',
  category: 'Receipt Settings',
  question: 'Paano i-customize ang store name/address/contact sa resibo?',
  keywords: ['receipt customization', 'store name', 'edit resibo', 'header footer resibo', 'paper size'],
  answer: `<p>Pumunta sa <strong>Receipt Settings</strong>. Doon mo mababago ang Store Name, Store Address, Store Contact, Header Text, Footer Text, at Paper Size (58mm/80mm).</p>
  <p><strong>May 2 LIBRENG pag-customize</strong> (hindi kasama ang Paper Size dahil hardware setting lang ito). Pagkatapos maubos ang 2 free attempts, kailangan na ng <strong>OTP (One-Time Password/Code) verification</strong> bago makapag-save ng bagong pagbabago.</p>`
},
{
  id: 'receipt-logo-header',
  category: 'Receipt Settings',
  question: 'Puwede bang maglagay ng logo sa resibo sa halip na text lang?',
  keywords: ['logo sa resibo', 'header image', 'store logo', 'larawan sa resibo', 'upload logo'],
  verdict: 'oo',
  answer: `<p>Oo — bukod sa simpleng text header, maaari ka nang mag-upload ng isang <strong>logo/imahe</strong> bilang header ng resibo sa halip na text lamang, na may opsyon din para sa alignment (left/center/right) nito sa itaas ng resibo.</p>`
},
{
  id: 'receipt-double-copy',
  category: 'Receipt Settings',
  question: 'Puwede bang mag-print ng dalawang kopya ng resibo sa isang beses?',
  keywords: ['double copy', 'dalawang kopya resibo', 'two copies receipt', 'print twice'],
  verdict: 'oo',
  answer: `<p>Oo — sa Advanced na bahagi ng Receipt Customization, maaaring i-on ang <strong>Double Copy</strong> para awtomatikong mag-print ng dalawang magkasunod na kopya ng parehong resibo (hal. isa para sa customer, isa para sa file ng tindahan) sa bawat benta, may sariling setting din para sa espasyo sa pagitan ng dalawang kopya.</p>`
},
{
  id: 'receipt-loyalty-qr-position',
  category: 'Receipt Settings',
  question: 'Saan lalagay ang QR code ng loyalty sa resibo?',
  keywords: ['loyalty qr resibo', 'qr position', 'qr code sa resibo'],
  answer: `<p>Kung naka-enable ang Loyalty Points, maaaring itakda kung saan ilalagay sa resibo ang QR code ng loyalty ng customer — sa itaas o sa ibaba ng barcode ng transaksyon.</p>`
},
{
  id: 'receipt-taiwan-template',
  category: 'Receipt Settings',
  question: 'May opsyon bang makitid na format ng resibo para sa ibang uri ng printer?',
  keywords: ['taiwan template', 'makitid na resibo', 'narrow receipt', 'compact receipt format'],
  verdict: 'oo',
  answer: `<p>Oo — may alternatibong format ng resibo na sumusunod sa mas makitid na sukat ng ilang uri ng thermal printer, na maaaring i-customize ang lapad mula 40mm hanggang 80mm. Naka-OFF ito by default at opsyonal lamang.</p>`
},
{
  id: 'receipt-transaction-id-format',
  category: 'Receipt Settings',
  question: 'Puwede bang baguhin ang format ng Transaction ID?',
  keywords: ['transaction id format', 'palitan format id', 'short transaction id'],
  verdict: 'oo',
  answer: `<p>Oo — maaari nang piliin ang format ng Transaction ID na gagamitin sa mga resibo at sa Transactions tab, depende sa preference ng negosyo.</p>`
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
  question: 'Paano mag-unlock ng Pro Theme?',
  keywords: ['pro theme', 'unlock theme', 'ocean pro', 'emerald pro', 'sunset pro', 'rosegold', 'cyber neon', 'coffee noir', 'mint frost', 'galaxy ambient', 'liquid glass', 'bayad theme'],
  answer: `<p>Sa Themes menu, may siyam (9) na Pro Theme na maaaring piliin (Ocean, Emerald, Sunset, Rose Gold, Cyber Neon, Coffee Noir, Mint Frost, Galaxy Ambient, at Liquid Glass), bawat isa may sariling kulay palette. Pare-pareho na ang presyo ng lahat — ₱149 bawat isa.</p>
  <ol>
    <li>Mag-request ng unlock — magpapadala ito ng OTP sa email ng may-ari/developer ng system.</li>
    <li>Kapag na-confirm ang OTP, naka-unlock na permanently ang theme na iyon para sa system mo.</li>
  </ol>
  <p>Pagkatapos ma-unlock ang isa o higit pa, puwede ka nang lumipat-lipat nang libre sa gitna ng lahat ng na-unlock na themes anumang oras.</p>`
},

{
  id: 'premium-features-list',
  category: 'Premium Features',
  question: 'Anong mga premium module meron sa OmniPOS?',
  keywords: ['premium features', 'paid modules', 'bayad na module', 'unlock feature', 'gembang icon', 'pro badge'],
  answer: `<p>Bukod sa Pro Themes, may mga buong modyul din ng OmniPOS na naka-lock bilang premium feature hangga't hindi pa ito naka-unlock: Purchase Orders Module, Customer Profiles & Loyalty, Promo Codes Module, Sales Analytics & Advanced Reports, Multi-Cashier Shift Oversight & Z-Reading, Roles & Permissions (RBAC) Management, Multi-Branch Dashboard, at ang bagong <strong>OmniPOS AI Assistant</strong>.</p>
  <p>Kapag sinubukang gamitin ang isang naka-lock na feature, lalabas ang detalye nito (pangalan, presyo, maikling paliwanag) at ang opsyong mag-request ng unlock.</p>
  <p><strong>Paalala:</strong> apat dito ang <strong>subscription na (buwanan o taunan)</strong> sa halip na isang beses lang bayaran — Cloud Backup, RBAC Management, Multi-Branch Dashboard, at AI Assistant. Ang iba pang module/theme ay isang beses lang bayaran, permanente nang naka-unlock. Tingnan ang hiwalay na FAQ tungkol sa mga subscription module para sa detalye.</p>`
},
{
  id: 'premium-bundle-tiers',
  category: 'Premium Features',
  question: 'May bundle o package ba para sa premium features imbes na isa-isahin?',
  keywords: ['bundle', 'upgrade tier', 'package ng features', 'basic standard pro upgrade', 'sabay-sabay na bumili'],
  verdict: 'oo',
  answer: `<p>Oo — sa halip na bilhin nang isa-isa, may mga inihandang package na mas mura kaysa kung isa-isahing bibilhin ang mga sakop na module:</p>
  <ul>
    <li><strong>Basic Upgrade</strong> — Sales Analytics & Advanced Reports + Promo Codes Module.</li>
    <li><strong>Standard Upgrade</strong> — lahat sa Basic, plus Customer Profiles & Loyalty at Multi-Cashier Shift Oversight.</li>
    <li><strong>Pro Upgrade (Complete)</strong> — LAHAT ng ibang module AT LAHAT ng Pro Theme — walang matitirang naka-lock, <strong>MALIBAN</strong> sa Cloud Backup, Roles & Permissions (RBAC) Management, Multi-Branch Dashboard, at AI Assistant, dahil hiwalay na itong bina-bill bilang sarili nilang subscription (buwanan/taunan), hindi kasama sa mga bundle/upgrade tier na ito.</li>
  </ul>
  <p>Kung mayroon ka nang nabili dati sa mga indibidwal na feature na kasama sa isang tier, awtomatikong bababa ang presyo ng bundle na iyon para hindi ka na muling magbayad para sa parehong feature.</p>`
},
{
  id: 'premium-demo-mode',
  category: 'Premium Features',
  question: 'Puwede bang subukan muna ang mga premium feature bago bumili?',
  keywords: ['demo mode', 'try demo', 'libreng subok', 'free trial', 'subukan bago bumili', 'trial period'],
  verdict: 'oo',
  answer: `<p>Oo — sa pamamagitan ng <strong>Demo Mode</strong>, puwede mong subukan ang LAHAT ng premium module at Pro Theme nang LIBRE sa loob ng limitadong oras (karaniwan ay 24 oras, pero maaaring iba ang itinakdang tagal ng developer/may-ari kapag inaprubahan nila ang request).</p>
  <ol>
    <li>Sa Premium Features page, i-request ang Demo — ipapadala ang request sa developer/may-ari ng system.</li>
    <li>Kapag na-approve, may matatanggap kang OTP code — ilagay ito para agad ma-activate ang Demo Mode.</li>
    <li>Habang aktibo, magagamit mo ang lahat ng premium module at Pro Theme nang walang bayad, hanggang sa mag-expire ang itinakdang tagal (o hanggang tapusin ito ng Admin nang mas maaga).</li>
  </ol>
  <p>Kung may na-purchase ka nang aktwal na feature bago o habang may demo, hindi ito maaapektuhan — permanenteng nananatili itong naka-unlock kahit matapos ang demo.</p>`
},
{
  id: 'premium-cloud-backup',
  category: 'Premium Features',
  question: 'Ano ang Cloud Backup at magkano ito?',
  keywords: ['cloud backup', 'online backup', 'postgres backup', 'backup sa cloud'],
  answer: `<p>Ang Cloud Backup ay ngayon ay isang <strong>subscription module</strong> (buwanan o taunan, HINDI na isang beses lang bayaran) na nagsi-sync ng buong database — lahat ng modyul, kasama ang user accounts (pero HINDI kasama ang passwords) — papunta sa secure na online storage, para protektado ang datos kung masira o mawala ang device.</p>
  <p>May tatlong tier: <strong>Basic, Standard, at Pro</strong> — nagkakaiba ang presyo depende sa piniling tier at billing cycle (buwanan/taunan). Pagkatapos ma-subscribe, may button para mag-backup nang manu-mano at para mag-restore mula sa huling cloud backup. Gumagamit din ito ng <strong>Cloud Tokens</strong> para sa bawat aktwal na sync/restore — tingnan ang hiwalay na FAQ tungkol sa Cloud Tokens.</p>`
},
{
  id: 'premium-module-subscriptions',
  category: 'Premium Features',
  question: 'Paano gumagana ang subscription para sa RBAC, Multi-Branch, at AI Assistant?',
  keywords: ['module subscription', 'buwanang bayad', 'monthly yearly subscription', 'rbac subscription', 'multi branch subscription', 'grace period', 'nag expire subscription'],
  answer: `<p>Ang <strong>Roles & Permissions (RBAC) Management</strong>, <strong>Multi-Branch Dashboard</strong>, at <strong>OmniPOS AI Assistant</strong> ay hindi na isang beses lang bayaran — <strong>subscription</strong> na ito, na pwedeng buwanan o taunan (mas mura kada buwan kung taunan ang piliin).</p>
  <ul>
    <li>Habang aktibo ang subscription, magagamit ang buong feature.</li>
    <li>Kapag nag-expire nang hindi na-renew, may <strong>7 araw na grace period</strong> muna bago i-lock ulit ang feature — sapat na oras para makapag-renew nang hindi biglaang natitigil ang paggamit.</li>
    <li>Pagkalampas ng grace period, ma-lo-lock ulit ang feature hanggang sa ma-renew.</li>
  </ul>
  <p>Hiwalay ito sa mga one-time na module/theme (Purchase Orders, Promo Codes, Customer CRM, atbp.) — permanente na ang mga iyon pagkatapos mabili.</p>`
},
{
  id: 'premium-ai-assistant',
  category: 'Premium Features',
  question: 'Ano ang OmniPOS AI Assistant at paano ito naiiba sa dating FAQ search?',
  keywords: ['ai assistant', 'artificial intelligence', 'ai chatbot', 'cloudflare workers ai', 'smart faq', 'ai sa faq'],
  answer: `<p>Ang <strong>OmniPOS AI Assistant</strong> ay isang advanced na help assistant na nakapaloob sa loob mismo ng FAQ page. Sa halip na basta maghanap ng eksaktong tugmang keyword tulad ng dating search, binabasa at inuunawa ng isang tunay na AI model ang tanong mo, tapos sasagot ito sa natural na Tagalog/English batay sa OmniPOS FAQ Knowledge Base.</p>
  <ul>
    <li>Ang TANGING pinagbabatayan ng sagot nito ay ang FAQ Knowledge Base ng system — hindi ito free-roaming chatbot na sasagot ng kahit anong tanong.</li>
    <li>Kailangan itong "i-unlock" muna bilang subscription module (buwanan/taunan) bago ito gumana.</li>
    <li>Kung naka-lock pa, o kung nag-timeout/nag-fail ang AI request, awtomatikong babalik ito sa dating keyword-based na FAQ search — walang matitigil na paggamit ng FAQ page.</li>
  </ul>`
},
{
  id: 'premium-multi-branch-usage',
  category: 'Premium Features',
  question: 'Paano gumagana ang Multi-Branch Dashboard sa Overview page?',
  keywords: ['all branches', 'multi branch dashboard usage', 'ibang branch data', 'business group code', 'branch name setup', 'combine branches'],
  answer: `<p>Kapag naka-unlock na ang <strong>Multi-Branch Dashboard</strong>, may lalabas na "All Branches" section sa Overview page na pinagsasama-sama ang benta, bilang ng transaksyon, at low-stock snapshot mula sa LAHAT ng branch ng negosyo (magkakaibang device/lokasyon) — halos real-time, na-a-update kada ilang minuto sa pamamagitan ng Relay.</p>
  <p>Para gumana ito, kailangang i-set up muna sa Store Settings ang <strong>Branch Name</strong> (hal. "Main Branch", "Branch 2 - Cubao") at ang <strong>Business Group Code</strong> — parehong Business Group Code ang ilalagay sa BAWAT branch na gusto mong pagsamahin sa isang combined view.</p>`
},

{
  id: 'system-forgot-admin-password',
  category: 'System Reset',
  question: 'Nakalimutan ko ang admin password, paano ito ma-reset?',
  keywords: ['forgot password', 'nakalimutan password', 'reset admin password', 'lost password'],
  answer: `<p>May dalawang paraan na ngayon:</p>
  <p><strong>1. Self-Service Password Reset (rekomendado)</strong> — sa Login screen, piliin ang opsyong "Forgot Admin Password". Ipapadala ang kahilingan para sa approval ng developer/may-ari ng system. Kapag na-approve, may matatanggap kang OTP code — ilagay ito kasama ang bagong password (hindi bababa sa 8 characters) para agad ma-update ang Admin password, <strong>nang HINDI kinakailangang burahin ang ibang datos</strong>. Kailangan ng aktibong internet connection para dito.</p>
  <p><strong>2. System Reset (Hard Factory Reset)</strong> — kung hindi available ang unang paraan, ang alternatibo ay ang Hard Factory Reset, na kailangang naka-setup na muna ang Gmail App Password sa Receipt Settings bago magamit. Kapag ginamit ito: ipapadala muna ang buong backup ng data sa email mo bago burahin ang data, tapos ibabalik ang mga user account sa default set ng mga account.</p>
  <p><strong>Mahalagang paalala:</strong> Kailangan mo munang naka-access ang isang Admin account (kahit anong Admin) para ma-trigger ang Hard Reset.</p>`
},
{
  id: 'system-reset-full',
  category: 'System Reset',
  question: 'Ano ang mangyayari kapag ginawa ang System Reset / Factory Reset?',
  keywords: ['factory reset', 'system reset', 'hard reset', 'clear all data', 'burahin lahat ng data'],
  answer: `<p>Ang <strong>Hard Factory Reset</strong> ay ADMIN-ONLY na aksyon, at ito ang sunud-sunod na mangyayari:</p>
  <ol>
    <li>Kokolektahin ang <strong>KUMPLETONG backup</strong> ng bawat data module sa system — kasama na ang users, products, transactions, refunds, logs, requests, categories, customers, debts, promo codes, purchase orders, low-stock tracking, shifts, loyalty security data, at Fraud & Anomaly Alerts.</li>
    <li>Ipapadala muna ang backup na ito sa email mo — <strong>kung mag-fail ang email</strong> (hal. maling app password), <strong>ihihinto ang buong reset</strong> at LIGTAS pa rin ang data.</li>
    <li>Kapag successful ang email, saka lang isasagawa ang pagbura: babalik ang users sa default set of accounts, at mabubura ang lahat ng business/transactional data — products, transactions, refunds, requests, customers, debts, promo codes, purchase orders, low-stock tracking, shifts, shift records, user activity logs, loyalty card security data, at Fraud & Anomaly Alerts (kasama na ang live fraud-velocity counters na ginagamit sa detection) — habang babalik naman sa default set ang categories.</li>
  </ol>
  <p><strong>Sinasadyang HINDI ginagalaw:</strong> ang bilang ng LIBRENG pag-customize ng resibo, pati na rin ang device identity/license data (installation ID, hardware fingerprint, device verification, Relay authorization) at system configuration (Store Settings, UX Settings, Receipt Settings, Advanced Settings, Roles & Permissions, Connectivity Mode) — para hindi magamit ang Factory Reset para lang maibalik ang 2 free attempts, at para hindi nawawala ang identity/configuration ng device.</p>`
},
{
  id: 'system-restore-backup',
  category: 'System Reset',
  question: 'Paano mag-restore mula sa backup file?',
  keywords: ['restore backup', 'ibalik ang backup', 'import backup file', 'recover data'],
  answer: `<p>Sa Restore Backup feature, kailangan ang Admin username, password, at ang backup file (galing sa dating Factory Reset email o manual export). Kapag na-verify ang admin credentials, ise-synchronize pabalik sa system ang <strong>bawat data module na nasa backup file na iyon</strong> — kasama ang users, products, transactions, refunds, user logs, requests, categories, carts, customers, debts, promo codes, purchase orders, low-stock tracking, shifts, loyalty security data, at Fraud & Anomaly Alerts, pati na rin ang iba pang module na naroroon sa file.</p>`
},

{
  id: 'requests-approval',
  category: 'Staff Requests',
  question: 'Ano ang Staff Requests at paano ito ina-approve?',
  keywords: ['staff requests', 'pending approval', 'approve reject', 'request approval'],
  answer: `<p>Kapag itinakda ng Admin na kailangan muna ng approval para sa isang role sa isang partikular na aksyon ("Direct Apply" naka-OFF), ang aksyong iyon ay <strong>hindi agad naa-apply</strong>. Sa halip, pumapasok ito sa <strong>Staff Requests</strong> bilang PENDING.</p>
  <p>Kasama rito ang: pagdagdag/pag-edit ng produkto, Quick Restock, pag-edit ng sariling profile, Receipt Customization, Store & Sales Settings, Appearance/UX Settings, at Advanced Settings — depende sa itinakda ng Admin sa Permission Matrix para sa bawat role.</p>
  <p>Ang Admin lang ang makaka-approve o makaka-reject nito. Kapag na-approve, saka lang aktwal na maa-apply ang pagbabago, at naka-log ang buong desisyon (kasama kung sino ang nag-approve/reject).</p>`
},

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
    <li><strong>Access ayon sa role</strong> — sinusunod ito kahit saan sa system, hindi lang sa itsura ng menu, at ngayon ay mas detalyado (granular) na ang maaaring itakda.</li>
    <li><strong>Kailangan ng Admin password</strong> (o password ng isang awtorisadong role, kung pinahintulutan) para sa mapanganib na aksyon tulad ng pag-void, pag-refund, manual discount, at pag-restore ng backup.</li>
    <li>Limitado ang laki ng file na puwedeng i-upload, para hindi ma-abuso ang system.</li>
  </ul>`
},
{
  id: 'security-database',
  category: 'Security',
  question: 'Saan naka-store ang data ng OmniPOS?',
  keywords: ['saan naka store data', 'database file', 'nasaan ang datos'],
  answer: `<p>Ligtas at maayos na naka-imbak ang lahat ng datos (users, products, transactions, logs, requests, categories, customers, promo codes, shifts, purchase orders, atbp.) sa iisang lugar sa loob ng system. Kaya naman simple lang ang paggawa ng backup — iisang file lang ang kailangang i-save.</p>`
},
{
  id: 'security-2fa',
  category: 'Security',
  question: 'Ano ang Two-Factor Authentication (2FA) sa login?',
  keywords: ['2fa', 'two factor authentication', 'otp sa login', 'dagdag na security login', 'email otp login'],
  answer: `<p>Kapag na-enable sa Settings → Advanced Settings, hihilingin ang isang <strong>6-digit na OTP code</strong> (ipapadala sa naka-configure na email) bawat magla-login — hindi lang username at password na, may karagdagang hakbang bago makapasok.</p>
  <p>Opt-in ito — desisyon ng Admin kung ie-enable at saang email na address ipapadala ang mga OTP code.</p>`
},
{
  id: 'security-fraud-detection',
  category: 'Security',
  question: 'Ano ang Fraud & Anomaly Detection?',
  keywords: ['fraud detection', 'anomaly alert', 'fraud alerts', 'kaduda-dudang transaksyon', 'fraud sensitivity'],
  answer: `<p>Kapag na-enable sa Settings → Advanced Settings, awtomatikong minomonitor ng system ang mga kaduda-dudang pattern ng aktibidad (hal. sunud-sunod na void/refund sa maikling panahon) at gumagawa ng <strong>Fraud & Anomaly Alert</strong> kapag napansin ito.</p>
  <ul>
    <li>May "sensitivity" setting (mababa/katamtaman/mataas) na nagtatakda kung gaano kabilis mag-trigger ng alert.</li>
    <li>May opsyon din na mag-email agad ng notification sa naka-configure na address kapag may bagong alert.</li>
    <li>Makikita ang lahat ng alert sa Fraud Alerts table sa loob ng Settings/Users tab (Admin access).</li>
  </ul>`
},

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
  id: 'update-new-modules',
  category: 'System Updates',
  question: 'Anong mga bagong function o module ang idinagdag sa OmniPOS?',
  keywords: ['bagong module', 'bagong function', 'malaking update', 'new modules', 'major update', 'mga bagong feature ngayon'],
  answer: `<p>Ilan sa mga pinakabagong dagdag na kakayahan ng OmniPOS:</p>
  <ul>
    <li><strong>Refund (Full/Partial)</strong> — pagbabalik ng bayad ng customer nang hindi kinakansela ang buong transaksyon.</li>
    <li><strong>Manual Discount</strong> sa cart — direktang pagbabawas ng halaga nang walang promo code.</li>
    <li><strong>Mas detalyadong (granular) Permission Matrix</strong> — kasama ang opsyong "sariling password" para sa ilang sensitibong aksyon.</li>
    <li><strong>AI Bulk Image Search</strong> — awtomatikong paghahanap ng litrato para sa maraming produkto nang sabay-sabay.</li>
    <li><strong>Quick Restock</strong> — mabilisang pagdagdag ng stock nang hindi gumagawa ng buong Purchase Order.</li>
    <li><strong>Loyalty Card/QR</strong> (Static o Rotating) para sa mga customer.</li>
    <li><strong>Self-Service Forgot Admin Password</strong> — hindi na kailangang mag-Hard Reset kung nakalimutan lang ang password.</li>
    <li><strong>Demo Mode</strong> at <strong>Bundle/Upgrade Tiers</strong> para sa premium features.</li>
    <li>Mga karagdagang opsyon sa Receipt Customization — logo header, double-copy printing, loyalty QR position, at makitid na (Taiwan) na format.</li>
  </ul>
  <p>Palagi itong ina-update sa tuwing may mga bagong pagbabago sa system.</p>`
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

{
  id: 'cloud-tokens-what',
  category: 'Cloud Tokens & Payments',
  question: 'Ano ang Cloud Tokens at para saan ito ginagamit?',
  keywords: ['cloud tokens', 'ano ang tokens', 'token wallet', 'bumili ng tokens', 'sync token', 'restore token'],
  answer: `<p>Ang <strong>Cloud Tokens</strong> ay parang "load" o e-wallet balance na ginagamit para bayaran ang bawat aktwal na <strong>Cloud Backup sync o restore</strong> — sa halip na maghintay ng buwanang bill, kaltas kada beses gamitin ang feature, base sa Cloud Backup tier mo (Basic/Standard/Pro).</p>
  <ul>
    <li>Bumibili ka ng package ng tokens (halimbawa sa pamamagitan ng GCash/Maya/card, depende sa naka-configure na payment method), tapos idinadagdag ito sa wallet mo.</li>
    <li>Makikita sa Cloud Backup section ang kasalukuyang balance ng tokens, at kung magkano ang gagastusin bawat sync/restore.</li>
    <li>Kung maubos ang tokens, hindi na maisasagawa ang susunod na sync/restore hangga't hindi ka bumibili ulit ng tokens.</li>
  </ul>`
},
{
  id: 'payment-methods',
  category: 'Cloud Tokens & Payments',
  question: 'Anong paraan ng pagbabayad ang tinatanggap sa pagbili ng feature/tokens?',
  keywords: ['paano magbayad', 'gcash', 'maya', 'paymaya', 'credit card', 'debit card', 'paypal', 'online banking', 'over the counter', 'payment options', 'bayad'],
  verdict: 'depende',
  answer: `<p>Depende ito sa kung anong payment provider ang naka-configure ng developer/may-ari ng system mo — awtomatikong lalabas lang bilang opsyon ang paraan ng bayad na aktwal na naka-set up (hindi lahat ay laging available):</p>
  <ul>
    <li><strong>GCash / Maya / Online Banking</strong> (QR Ph) — sa pamamagitan ng PayMongo o Xendit.</li>
    <li><strong>GrabPay at Bank Transfer</strong> — sa pamamagitan ng Xendit.</li>
    <li><strong>Credit/Debit Card (international)</strong> — sa pamamagitan ng Stripe.</li>
    <li><strong>PayPal</strong> — direktang PayPal account.</li>
    <li><strong>Over-the-Counter</strong> (7-Eleven, Cebuana Lhuillier, LBC, atbp.) at InstaPay/PESONet Bank Transfer — sa pamamagitan ng Dragonpay.</li>
  </ul>
  <p>Kapag walang anumang provider na naka-configure, walang lalabas na opsyon ng online payment — sa ganitong kaso, direkta na lang sa developer/may-ari makipag-ayos para sa unlock request.</p>`
},

{
  id: 'advanced-customer-display',
  category: 'Advanced Settings',
  question: 'Ano ang Customer-Facing Display at paano ito buksan?',
  keywords: ['customer display', 'second screen', 'pantalya ng customer', 'monitor ng customer', 'facing screen', 'ikalawang screen'],
  answer: `<p>Ang <strong>Customer-Facing Display</strong> ay ikalawang screen (monitor o tablet na nakaharap sa customer) na live na nagpapakita ng laman ng cart habang nagti-tanan ang cashier, at may thank-you screen pagkatapos ng bawat benta.</p>
  <ol>
    <li>Sa Settings → Advanced Settings, i-enable ang "Customer-Facing Display".</li>
    <li>Pwede ring itakda ang "compact threshold" — kapag lumagpas ang bilang ng linya sa cart sa itinakdang numerong ito, awtomatikong pinapaliit ang mga row ng display para makasya pa rin lahat kasama ang Total, kahit walang pag-scroll.</li>
    <li>I-click ang "Open Customer Display" — bubukas ito bilang bagong window/tab na pwedeng ilipat sa ikalawang monitor o kabilang tablet.</li>
  </ol>`
},
{
  id: 'advanced-idle-lock',
  category: 'Advanced Settings',
  question: 'Ano ang Idle-Session Auto-Lock?',
  keywords: ['idle lock', 'auto lock', 'awtomatikong lock', 'walang galaw lock', 'auto lock minutes'],
  answer: `<p>Kapag na-enable sa Settings → Advanced Settings, awtomatikong nag-i-lock ang session (kailangan mo munang mag-verify ulit para makabalik) kapag walang aktibidad (walang click/type/touch) sa loob ng itinakdang bilang ng minuto. Naitatakda mo ang eksaktong bilang ng minuto bago mag-lock.</p>
  <p>Ito ay opt-in lang — hindi ito nagbabago sa 8-oras na session timeout ng buong login; hiwalay itong proteksyon laban sa taong makakakita ng bukas at naka-login na screen habang walang bantay.</p>`
},
{
  id: 'advanced-sale-webhook',
  category: 'Advanced Settings',
  question: 'Ano ang Sale Webhook at para saan ito?',
  keywords: ['sale webhook', 'webhook', 'zapier', 'make integration', 'accounting integration', 'i-connect sa ibang app'],
  answer: `<p>Ang <strong>Sale Webhook</strong> ay opt-in na integration na awtomatikong nagpapadala ng detalye ng bawat kumpletong benta papunta sa ibang tool sa labas ng OmniPOS — hal. Zapier, Make, o software ng accounting — sa pamamagitan ng isang webhook URL.</p>
  <p>Sa Settings → Advanced Settings, i-enable ang Sale Webhook, tapos ilagay ang buong <code>http://</code> o <code>https://</code> URL na ibinigay ng ibang app/tool mo. Hindi tatanggapin ang setting kung walang valid na URL na nakalagay bago i-enable.</p>`
},

{
  id: 'settings-store-sales',
  category: 'Store & Appearance Settings',
  question: 'Ano ang mababago sa Store & Sales Settings?',
  keywords: ['store settings', 'sales settings', 'currency', 'tax setting', 'senior citizen discount', 'pwd discount', 'loyalty earn rate', 'accepted payment methods'],
  answer: `<p>Sa Settings → Store & Sales, maaaring i-configure ang:</p>
  <ul>
    <li><strong>Currency</strong> at <strong>Tax</strong> (i-enable/i-disable, tax label, tax rate %, kung kasama na ba sa presyo ng produkto ang tax).</li>
    <li><strong>Accepted Payment Methods</strong> na lalabas bilang opsyon sa POS Terminal checkout (Cash, GCash, Maya, Card, Bank Transfer) — hiwalay ito sa mga payment provider (PayMongo/Xendit/atbp.) na ginagamit para sa pagbili ng premium feature/Cloud Tokens.</li>
    <li><strong>GCash/Maya QR codes</strong> na ipapakita sa customer sa Payment modal para ma-scan.</li>
    <li><strong>Senior Citizen / PWD Discount</strong> (i-enable at itakda ang discount rate).</li>
    <li><strong>Loyalty Points</strong> — i-enable ang earn/redeem, itakda ang earn rate (₱ kada 1 point) at redeem value (₱ discount kada 1 point).</li>
    <li><strong>Branch Name</strong> at <strong>Business Group Code</strong> — para sa Multi-Branch Dashboard (tingnan ang hiwalay na FAQ).</li>
  </ul>`
},
{
  id: 'settings-appearance-ux',
  category: 'Store & Appearance Settings',
  question: 'Ano ang mababago sa Appearance & UX Settings?',
  keywords: ['appearance settings', 'ux settings', 'dark mode', 'low stock threshold', 'scanner sound', 'dashboard widgets', 'swap terminal layout'],
  answer: `<p>Sa Settings → Appearance & UX, maaaring i-configure (bawat setting dito ay <strong>per-device</strong>, hindi pareho sa lahat):</p>
  <ul>
    <li><strong>Dark Mode</strong> bilang default sa device na ito.</li>
    <li><strong>Low-Stock Alert Threshold</strong> (bilang ng units bago mag-alert bilang mababa na ang stock).</li>
    <li><strong>Barcode Scanner Sound Feedback</strong> — tunog kapag matagumpay na na-scan.</li>
    <li><strong>Swap Order Cart / Product List Position</strong> sa POS Terminal (Desktop lang, sa device na ito lang) — puwede ring i-drag mismo ang "Order" header papuntang kanan bilang alternatibong paraan.</li>
    <li><strong>Dashboard Widgets</strong> na ipapakita — Sales Today, Low Stock, Top Products, Recent Transactions.</li>
  </ul>`
},

];
