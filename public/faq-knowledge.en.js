

window.OMNIPOS_FAQ_KB_EN = [

{
  id: 'overview-what-is',
  category: 'Overview',
  question: 'What is OmniPOS?',
  keywords: ['ano ang omnipos', 'what is omnipos', 'tungkol sa system', 'about the system', 'point of sale', 'pos system', 'anong app ito'],
  answer: `<p><strong>OmniPOS</strong> is an all-in-one <strong>Point-of-Sale (POS) and Inventory Management System</strong> that covers the whole operation of a store or business:</p>
  <ul>
    <li>Sales and checkout (POS Terminal)</li>
    <li>Inventory/stock monitoring</li>
    <li>Barcode generator and receipt printing</li>
    <li>Purchase Orders and Reorder Alerts</li>
    <li>Customer Loyalty Points</li>
    <li>Shift / Z-Reading (closing out sales per shift)</li>
    <li>Sales Reports and User Logs</li>
    <li>Managing users and their respective access (roles)</li>
  </ul>`
},
{
  id: 'overview-offline',
  category: 'Overview',
  question: 'Does OmniPOS need internet to work?',
  keywords: ['internet', 'offline', 'walang internet', 'local network', 'no wifi'],
  verdict: 'depende',
  answer: `<p>The <strong>core features</strong> don't need internet: POS checkout, inventory, transactions, shift/Z-Reading, reports — these all work as long as the device you're using and the system are connected to the same network.</p>
  <p>Only the following <strong>require an active internet connection</strong>:</p>
  <ul>
    <li>Sending email receipts to customers</li>
    <li>OTP (One-Time Password/Code) verification — for Receipt Customization, Pro Theme/Premium Feature unlocking, Demo Mode, Factory Reset backup, and resetting a forgotten Admin password</li>
    <li>AI Bulk Image Search — automatic photo search for products</li>
    <li>Cloud Backup and Multi-Branch Dashboard — syncing data to online storage or to another branch</li>
  </ul>`
},
{
  id: 'overview-lan-qr-access',
  category: 'Overview',
  question: 'How do I open OmniPOS using a QR code on another device (LAN)?',
  keywords: ['qr code open device', 'scan para makapasok', 'server ip qr', 'ibang device lan', 'connect ibang cellphone'],
  answer: `<p>While the system is in LAN mode (devices on the same network/WiFi), a <strong>"Server IP QR Code"</strong> is available in the system — it shows a QR code encoding the server's network address.</p>
  <p>Just scan it with the camera or QR scanner of another device (as long as it's on the same WiFi/LAN) to open OmniPOS directly there, without needing to manually type the IP address.</p>`
},
{
  id: 'overview-install-app',
  category: 'Overview',
  question: 'How do I install OmniPOS as an app (Add to Home Screen)?',
  keywords: ['install omnipos', 'add to home screen', 'install the app', 'pwa', 'download the app', 'install app banner', 'full screen no browser bar'],
  verdict: 'yes',
  answer: `<p>Yes — no Play Store or App Store needed. OmniPOS is an installable web app (<strong>PWA</strong>), so it can be added to your phone/tablet's home screen to run like a normal app — <strong>full-screen, no browser address bar, and a faster launch</strong>.</p>
  <ul>
    <li><strong>On Android/Chrome:</strong> an install banner appears at the bottom of the screen (if not installed yet) with an <em>"Install"</em> button — tap it and confirm the browser's native prompt.</li>
    <li><strong>On iPhone/iPad (iOS Safari):</strong> there's no automatic install button due to an iOS limitation — tap the <strong>Share</strong> icon in Safari, then choose <strong>"Add to Home Screen"</strong>.</li>
  </ul>
  <p>If the install banner is dismissed, it won't reappear for <strong>7 days</strong>. It also won't show once the app is already installed (running as a standalone app).</p>`
},
{
  id: 'overview-connectivity-mode',
  category: 'Overview',
  question: 'What is the Online/Offline Connectivity Mode button in the user menu?',
  keywords: ['connectivity mode', 'online offline toggle', 'wifi icon header', 'checking connection', 'manual offline mode', 'connectivity mode button'],
  answer: `<p>This is found in the <strong>user/profile menu</strong> at the top (next to the Fullscreen and Dark Mode toggles) as a pill/button with a WiFi icon — it shows the current status: <strong>Online</strong>, <strong>Offline</strong>, or <strong>"Checking…"</strong> while it confirms whether there's internet.</p>
  <ul>
    <li>It automatically checks every time you log in — if there's internet, it's painted <strong>Online</strong>; if not, it's painted <strong>Offline</strong>.</li>
    <li>You can also tap it manually to switch: forcing it to <strong>Offline</strong> stops the system from proactively contacting the Relay server (e.g. auto cloud backup, update-check) — but the POS itself (checkout, inventory, etc.) keeps working normally, since it really only needs the local network.</li>
    <li>If you try to switch back to <strong>Online</strong> while there's no real internet connection, a warning appears and it won't switch until a connection is confirmed.</li>
  </ul>
  <p>In short: this doesn't control whether the POS works or not (it works fine as long as it's on the LAN) — it only controls when the system will try to talk to the internet/Relay.</p>`
},

{
  id: 'login-how',
  category: 'Login & Sessions',
  question: 'How do I log in to OmniPOS?',
  keywords: ['login', 'mag-login', 'paano mag login', 'sign in', 'log in form', 'username password'],
  answer: `<p>Just enter your <strong>username</strong> and <strong>password</strong> in the Login Form, then submit. Once your details are correct, you'll be taken straight to the Dashboard, and you'll only see the menus your role is allowed to access.</p>
  <p><strong>Note:</strong> There's a limit on failed attempts (5 tries per 10 minutes) to protect against people trying to guess the password.</p>`
},
{
  id: 'login-session-expiry',
  category: 'Login & Sessions',
  question: 'How long before a session automatically logs out?',
  keywords: ['session expire', 'auto logout', 'gaano katagal login', 'session timeout', '8 hours'],
  answer: `<p>You won't be auto-logged-out while you're actively using the system. Only after <strong>a full 8 hours</strong> of inactivity will the session expire, and you'll need to log in again.</p>
  <p><strong>Note:</strong> If the whole system restarts (not just a browser refresh), everyone who was previously logged in will need to log in again.</p>`
},
{
  id: 'login-active-sessions',
  category: 'Login & Sessions',
  question: 'What is Active Sessions / Active Users?',
  keywords: ['active sessions', 'active users', 'sino naka login', 'ilang device naka-login'],
  answer: `<p>This shows all accounts that are <strong>currently logged in</strong>, along with the username, role, and how many minutes they've been logged in. Anyone who's logged in can view this.</p>
  <p>If the same user is using a different device or tab, they'll appear as separate entries in the list.</p>`
},
{
  id: 'logout-how',
  category: 'Login & Sessions',
  question: 'How do I log out?',
  keywords: ['logout', 'mag logout', 'sign out'],
  answer: `<p>There's a Logout button in the profile/sidebar menu. Once clicked, your previous session is immediately invalidated — even if someone gets hold of an old link or the device you used before.</p>`
},
{
  id: 'login-biometric',
  category: 'Login & Sessions',
  question: 'How do I enable Fingerprint/Biometric Login?',
  keywords: ['fingerprint login', 'biometric login', 'webauthn', 'face id', 'passkey', 'walang password login', 'touch id'],
  answer: `<p><strong>Fingerprint Login</strong> (using WebAuthn — fingerprint, Face ID, or device PIN) is an optional way to log in without typing your password, on the same device.</p>
  <ol>
    <li>First log in normally with your username/password.</li>
    <li>In profile settings, click the option to enable Fingerprint Login on the device you're using — it will use your phone, tablet, or laptop's built-in fingerprint/Face ID/PIN.</li>
    <li>Next time you open the Login page on the same device, a "Login with Fingerprint" option will appear — tap it instead of typing your password.</li>
  </ol>
  <p>Each enabled device shows up in its own list in profile settings, and you can remove them individually if you want to disable it on a particular device.</p>`
},

{
  id: 'roles-permission-matrix',
  category: 'Roles & Permissions',
  question: 'How do Roles and Permissions work?',
  keywords: ['roles', 'permissions', 'permission matrix', 'access control', 'menu access', 'sino pwede'],
  answer: `<p>The Admin decides which menus/features each role (Admin, Staff, Cashier, or a custom role) can see or use through the <strong>Permission Matrix</strong> in the Settings tab — no need to request a developer to change this.</p>
  <p>The matrix is now more detailed (granular) — beyond just which menus a role can see, it can also separately control which specific ACTIONS that role can perform (e.g. void, refund, authorize a manual discount), and whether it still needs Admin approval or not.</p>
  <p><strong>Admin</strong> always has access to everything, regardless of what's set in the matrix.</p>`
},
{
  id: 'roles-default',
  category: 'Roles & Permissions',
  question: 'What are the default roles in OmniPOS?',
  keywords: ['default roles', 'admin staff cashier', 'anong roles meron'],
  answer: `<p>There are 3 built-in roles by default:</p>
  <ul>
    <li><strong>Admin</strong> — full access to everything, cannot be deleted.</li>
    <li><strong>Staff</strong> — POS Terminal, Dashboard, Products, Barcode, own Transactions, Customers, Shift/Z-Reading (including the sales amounts).</li>
    <li><strong>Cashier</strong> — POS Terminal, own Transactions, Customers, Shift/Z-Reading, but <strong>cannot</strong> see the Gross Sales/Discount/Net Sales figures.</li>
  </ul>
  <p>You can create a new custom role (e.g. "Supervisor") in the Settings tab, and set which menus they can use there as well.</p>`
},
{
  id: 'roles-own-password',
  category: 'Roles & Permissions',
  question: 'Can a Supervisor/Staff member authorize an action with their own password instead of needing the Admin?',
  keywords: ['sariling password', 'own password', 'supervisor password', 'hindi admin password', 'authorize without admin'],
  verdict: 'oo',
  answer: `<p>Yes — for sensitive actions (Void, Refund, Manual Discount, manual Loyalty Points redemption, and closing another cashier's shift), the Admin password is required by default. If the Admin wants to give a role (e.g. Supervisor) the ability to authorize with <strong>their own password</strong> instead of needing the Admin, this can be toggled on separately per action in the Permission Matrix.</p>
  <p>This has no effect on other actions that aren't toggled — each action has its own individual on/off switch.</p>`
},
{
  id: 'roles-add-user',
  category: 'Roles & Permissions',
  question: 'How do I add a new user or cashier account?',
  keywords: ['add user', 'bagong cashier', 'gumawa ng account', 'new employee account', 'magdagdag ng user'],
  answer: `<p>Go to the <strong>Settings</strong> tab (Admin access only), inside the <strong>Users Management</strong> tab. Click "Add User", fill in the username, password, and choose the role. The password you enter is automatically encrypted/secured — it is never stored as plain text.</p>`
},
{
  id: 'roles-edit-profile',
  category: 'Roles & Permissions',
  question: 'How do I edit my own profile (username/avatar)?',
  keywords: ['edit profile', 'palitan avatar', 'palitan username', 'update profile'],
  verdict: 'depende',
  answer: `<p>In the Profile widget/dropdown, there's an "Edit Profile" option to change your username and/or avatar. This depends on the setting the Admin has set for your role:</p>
  <ul>
    <li>If it's allowed (or you're an Admin), the change is <strong>applied immediately</strong>.</li>
    <li>If not (typical for non-Admins), it first goes into <strong>Staff Requests</strong> as PENDING — the Admin needs to approve it.</li>
  </ul>
  <p><strong>Note:</strong> <strong>Past transactions and logs</strong> are intentionally left under your old name, so the record of what happened at that time stays clear.</p>`
},

{
  id: 'pos-checkout',
  category: 'POS Terminal',
  question: 'How do I checkout or make a sale using the POS Terminal?',
  keywords: ['checkout', 'magbenta', 'paano bumili', 'pos terminal', 'sale', 'add to cart', 'scan barcode'],
  answer: `<p>Go to the <strong>POS Terminal</strong>, select or scan (using the camera or a barcode scanner) the products being bought to add them to the cart, then press <strong>Checkout</strong>.</p>
  <ul>
    <li>Before the sale is completed, the system first checks whether each item still has enough stock — this matters when several terminals are selling at the same time. If stock is insufficient, it will clearly tell you which product is short.</li>
    <li>Once it passes, stock is automatically deducted, and the name of the cashier who made the sale is recorded.</li>
    <li>If a customer is attached, their loyalty points and record are automatically updated.</li>
  </ul>`
},
{
  id: 'pos-promo-code',
  category: 'POS Terminal',
  question: 'How do I use a promo code in the POS Terminal?',
  keywords: ['promo code', 'discount code', 'coupon', 'promocode'],
  answer: `<p>In the POS Terminal's cart, just enter the promo code in the provided field. The system automatically checks whether:</p>
  <ul>
    <li>The code is still <strong>active</strong> (not disabled)</li>
    <li>It hasn't <strong>expired</strong> (if it has an expiry date)</li>
    <li>The subtotal has reached the <strong>minimum spend</strong>, if any</li>
  </ul>
  <p>The discount can be a <strong>percentage</strong> or a <strong>fixed amount</strong> — it will never exceed the total amount of the purchase. Anyone who's logged in can use a valid promo code at checkout — only creating/editing promo codes requires special access.</p>`
},
{
  id: 'pos-manual-discount',
  category: 'POS Terminal',
  question: 'How do I give a manual discount without a promo code?',
  keywords: ['manual discount', 'discount hindi promo code', 'bawasan ang presyo', 'special discount', 'custom discount'],
  answer: `<p>Besides Promo Code, there's a separate field in the cart summary — <strong>"Discount"</strong> — where you can enter any amount as a discount directly, e.g. for a special arrangement with a customer who doesn't have a promo code.</p>
  <ul>
    <li>It will never exceed the total amount of the purchase.</li>
    <li>You'll be asked for the Admin/Supervisor password before the Charge can proceed, unless the Admin has given you access to use your own password instead.</li>
    <li>The full details of the manual discount, including who authorized it, are recorded in the transaction's audit log.</li>
  </ul>`
},
{
  id: 'pos-customer-loyalty',
  category: 'POS Terminal',
  question: 'How does Customer Loyalty Points work?',
  keywords: ['loyalty points', 'customer points', 'rewards', 'redeem points', 'select customer', 'loyalty program', 'earn rate', 'loyalty card', 'loyalty qr'],
  answer: `<p>In the POS Terminal, there's a "Select Customer" option to attach a registered customer to the transaction. Once checked out:</p>
  <ul>
    <li>The customer earns points based on the configured earn rate under Settings → Store &amp; Sales (default: <strong>1 point for every ₱100</strong> spent).</li>
    <li>If the customer is redeeming points, those are deducted first (as a discount, based on the configured "₱ value per point") before the newly earned points are added.</li>
    <li>The customer's record (total amount spent and visit count) is automatically updated.</li>
    <li>The points earned and the new balance appear right on the receipt.</li>
    <li>A customer can also earn points when a <strong>Debtors (C-Credit)</strong> record is fully paid — not only on direct cash/e-wallet sales.</li>
  </ul>
  <p>You can also issue a digital <strong>Loyalty Card/QR</strong> to a customer (rotating or static mode) that can be scanned at checkout to identify/use their points right away — it can be revoked and re-issued if lost or misused.</p>`
},
{
  id: 'pos-split-payment',
  category: 'POS Terminal',
  question: 'Can I use two payment methods in one sale?',
  keywords: ['split payment', 'dalawang payment', 'cash and gcash', 'multiple payment method'],
  verdict: 'oo',
  answer: `<p>Yes — <strong>split or multiple payment methods</strong> in a single transaction are supported (e.g. part Cash, part GCash). Cash counting in Z-Reading still stays accurate since each payment method is recorded separately.</p>`
},
{
  id: 'pos-bluetooth-printer',
  category: 'POS Terminal',
  question: 'How do I use a Bluetooth printer with the POS Terminal?',
  keywords: ['bluetooth printer', 'wireless printer', 'thermal printer bluetooth', 'cash drawer bluetooth', 'i-connect printer'],
  answer: `<p>Printing receipts and opening the cash drawer via a <strong>Bluetooth thermal printer</strong> is supported — once "Bluetooth" is selected as the print method in settings, receipts go straight to the paired Bluetooth printer instead of just showing on screen or using the regular browser print.</p>
  <p>If a compatible Bluetooth cash drawer is also connected to the printer, it will automatically open on every new cash sale/refund as well.</p>`
},

{
  id: 'inv-add-product',
  category: 'Inventory',
  question: 'How do I add a new product to Inventory?',
  keywords: ['add product', 'bagong produkto', 'magdagdag ng item', 'new product'],
  answer: `<p>Go to <strong>Inventory → Products</strong>, click the button to add a new item (Code, Name, Category, Price, Stock, Supplier, Expiry Date, Low Stock Threshold, Cost Price).</p>
  <p><strong>Note:</strong> If the Admin has set your role to require approval first, the change will first go into <strong>Staff Requests</strong> — it won't be applied until it's approved.</p>`
},
{
  id: 'inv-import-export',
  category: 'Inventory',
  question: 'How do I import or export products (Excel/CSV)?',
  keywords: ['import products', 'export products', 'excel template', 'csv', 'bulk upload', 'maramihang produkto'],
  answer: `<p><strong>Import:</strong> go to the Products page, first download the <strong>Excel template</strong> to make sure the column format is correct, fill it in, then upload it. There's a file size limit (10MB) for uploads.</p>
  <p><strong>Export:</strong> there's a button to download the current inventory as a CSV file (Code, Name, Category, Price, Stock, Supplier, Expiry Date, Low Stock Threshold, Cost Price).</p>`
},
{
  id: 'inv-barcode',
  category: 'Inventory',
  question: 'How do I generate or print a barcode?',
  keywords: ['barcode', 'print barcode', 'generate barcode', 'scan produkto'],
  answer: `<p>Go to <strong>Inventory → Barcode</strong>. There you'll see each product's barcode based on its product code, which can be printed for scanning whenever there's a sale at the POS Terminal (using either the camera scanner or a hardware barcode scanner).</p>`
},
{
  id: 'inv-low-stock',
  category: 'Inventory',
  question: 'How do I know which products are running low on stock?',
  keywords: ['low stock', 'mababang stock', 'out of stock', 'reorder alert', 'lowstock'],
  answer: `<p>There's a <strong>Reorder Alerts</strong> page that shows all products that have dropped below their Low Stock Threshold, along with how many days they've been flagged as low or out-of-stock (it automatically disappears from the list once restocked).</p>
  <p>From here, you can:</p>
  <ul>
    <li><strong>Quick Restock</strong> — quickly add stock</li>
    <li>Create a <strong>Purchase Order</strong> per-supplier for better tracking of orders</li>
  </ul>`
},
{
  id: 'inv-quick-restock',
  category: 'Inventory',
  question: 'What is Quick Restock and how do I use it?',
  keywords: ['quick restock', 'mabilisang restock', 'dagdag stock', 'add stock fast', 'restock nang mabilis'],
  answer: `<p><strong>Quick Restock</strong> is for quickly adding stock without having to create a full Purchase Order — e.g. you just bought a few pieces from the market or a sari-sari store.</p>
  <ol>
    <li>In Reorder Alerts, find the product you want to add stock to, then click the Quick Restock button next to it.</li>
    <li>Enter the quantity to add, then confirm.</li>
  </ol>
  <p>If the Admin has given you "direct apply" access, it's added to stock immediately. If not, it first goes into Staff Requests as PENDING until the Admin approves it.</p>`
},
{
  id: 'inv-bulk-image-search',
  category: 'Inventory',
  question: 'Is there a way to automatically find photos for many products at once?',
  keywords: ['bulk image search', 'ai photo search', 'awtomatikong litrato', 'search images produkto', 'maramihang larawan', 'product photo search'],
  answer: `<p>Yes — use the <strong>Bulk Search Images</strong> tool on the Products page. It automatically searches online for a photo for each product (based on its name) and suggests the best-matching image — nothing is applied until you choose.</p>
  <ol>
    <li>Open Bulk Search Images, choose whether to run it on "products that don't have a photo yet", and set how many products to process in one run.</li>
    <li>Start the search — you'll see the progress as it runs.</li>
    <li>Review the suggested images — untick any that are wrong or unsuitable.</li>
    <li>Apply to save the chosen photos to their respective products.</li>
  </ol>
  <p><strong>Note:</strong> This requires an internet connection, and there's a limit (quota) on how many products can be processed per run — you can simply run it again for the rest.</p>`
},
{
  id: 'inv-purchase-order',
  category: 'Inventory',
  question: 'How do Purchase Orders work?',
  keywords: ['purchase order', 'po', 'order sa supplier', 'receive order', 'cancel order'],
  answer: `<p>On the Reorder Alerts / Purchase Orders page, you can create a Purchase Order per supplier — select the items and quantities to arrange.</p>
  <ul>
    <li><strong>Receive:</strong> once the order arrives, click "Receive" — all items in it are <strong>automatically added to stock</strong>.</li>
    <li><strong>Cancel:</strong> if the order didn't push through, just cancel it (it will no longer apply to stock).</li>
  </ul>`
},

{
  id: 'tx-view',
  category: 'Transactions',
  question: 'Where can I see all sold transactions?',
  keywords: ['view transactions', 'transaction history', 'listahan ng benta', 'sales history'],
  answer: `<p>In the <strong>Transactions</strong> tab. By default, you'll only see <strong>your own</strong> transactions (as a cashier). If the Admin has given you access to see everyone's, you'll see transactions from ALL cashiers.</p>`
},
{
  id: 'tx-void',
  category: 'Transactions',
  question: 'How do I void or cancel a transaction?',
  keywords: ['void transaction', 'kanselahin', 'cancel transaction', 'undo sale'],
  answer: `<p>In <strong>Transactions</strong>, find the order you want to void, then click the void option. You'll be asked for the <strong>Admin password</strong> (or your own password, if the Admin has given you this access) before it proceeds:</p>
  <ol>
    <li>Once the password is correct, the stock of all items in the transaction is <strong>automatically returned</strong> to inventory.</li>
    <li>The transaction is removed from the list, but the full details are <strong>still logged</strong> for the audit trail and to be tallied in Z-Reading.</li>
  </ol>
  <p><strong>Note:</strong> Failed password attempts are limited (8 times per 10 minutes) for protection. You also can't void a transaction that already has a recorded refund — use Refund instead for the remaining balance.</p>`
},
{
  id: 'tx-refund',
  category: 'Transactions',
  question: 'How do I refund a transaction (full or partial)?',
  keywords: ['refund', 'i-refund', 'partial refund', 'full refund', 'ibalik ang bayad', 'money back', 'sauli ng bayad'],
  answer: `<p>Besides Void (which cancels the WHOLE transaction), you can now process a <strong>Refund</strong> — returning the customer's payment, whether in full or partial, without cancelling the whole transaction.</p>
  <ol>
    <li>In Transactions, find the transaction you want to refund, then click the Refund option.</li>
    <li>Choose which item(s) and how many pieces (quantity) to refund — this can be the full amount or just part of each line.</li>
    <li>Enter a reason for the refund.</li>
    <li>Enter the Admin password, or your own password if you've been given this access.</li>
    <li>Once confirmed, the refunded items are automatically returned to stock.</li>
  </ol>
  <p>You can do partial refunds on the same transaction repeatedly (e.g. one item now, another later), until you reach the full amount of the original sale. The count and amount of refunds also appear in Z-Reading and in Sales Analytics.</p>`
},

{
  id: 'shift-what',
  category: 'Shift / Z-Reading',
  question: 'What is Shift / Z-Reading?',
  keywords: ['shift', 'z-reading', 'zreading', 'end of day report', 'cash count'],
  answer: `<p>A "Shift" is the period from a cashier's <strong>last shift close</strong> until now. It's <strong>per-cashier</strong> — each cashier, regardless of which terminal they're using, has their own separate open shift.</p>
  <p>The Z-Reading is the <strong>closing report</strong> that contains: number of transactions, gross sales, total discount, net sales, breakdown per payment method, number/amount of voids, and <strong>cash variance</strong> (short/over) based on the cash counted in the drawer.</p>`
},
{
  id: 'shift-open',
  category: 'Shift / Z-Reading',
  question: 'How do I open a shift (Beginning Cash Float)?',
  keywords: ['beginning cash', 'open shift', 'simulan ang shift', 'starting cash'],
  answer: `<p>The first time you open the POS Terminal within a new shift, you'll be asked to enter the <strong>Beginning Cash Float</strong> — the amount of cash in the drawer before you start selling.</p>
  <p>This can't be changed once set, until the next time you close your own shift.</p>`
},
{
  id: 'shift-close',
  category: 'Shift / Z-Reading',
  question: 'How do I close a shift / do a Z-Reading?',
  keywords: ['close shift', 'isara ang shift', 'end shift', 'ending cash'],
  answer: `<p>On the Shift/Z-Reading tab, click "Close Shift". You'll enter the <strong>Ending Cash Counted</strong> (the actual counted contents of the drawer). The system automatically calculates:</p>
  <ul>
    <li><strong>Expected Cash</strong> = Beginning Cash + Cash-method sales</li>
    <li><strong>Cash Variance</strong> = Ending Cash Counted − Expected Cash (negative = <strong>SHORT</strong>, positive = <strong>OVER</strong>)</li>
  </ul>
  <p>You can't close a shift if there's no new transaction or void since the last close. After closing, you'll need to set a new Beginning Cash the next time you open the terminal.</p>`
},
{
  id: 'shift-supervisor-control',
  category: 'Shift / Z-Reading',
  question: 'Can an Admin close another cashier\'s shift?',
  keywords: ['close other cashier shift', 'supervisor control', 'admin close shift ng iba'],
  verdict: 'depende',
  answer: `<p>Yes, if the Admin has given your role this access. The Admin/Supervisor can see a list of all cashiers with a currently <strong>open</strong> shift, and can select and close their shift — even from a different terminal than the one it was opened on.</p>
  <p>An ordinary Cashier/Staff member (without this access) can only close <strong>their own</strong> shift.</p>`
},
{
  id: 'shift-cashier-hidden-amounts',
  category: 'Shift / Z-Reading',
  question: 'Why can\'t I see Gross Sales/Net Sales as a Cashier?',
  keywords: ['hindi makita sales amount', 'hidden peso amount', 'gross sales hindi lumalabas'],
  answer: `<p>This is intentional, set by the Admin for the privacy of peso figures — it's OFF by default for the Cashier role, but they can still see the transaction count and breakdown per payment method (still needed for cash counting/closing their Z-Reading).</p>
  <p>If you need to see this, it can be requested from the Admin to enable it for your role.</p>`
},

{
  id: 'reports-sales',
  category: 'Reports',
  question: 'Where can I see total sales and the best-selling products?',
  keywords: ['sales report', 'kabuuang benta', 'bestseller', 'top selling', 'gross income'],
  answer: `<p>The <strong>Sales Report</strong> shows gross income, number of transactions, and the ranking of top-selling products — always up to date based on actual recorded sales.</p>`
},
{
  id: 'reports-user-logs',
  category: 'Reports',
  question: 'What can I see in User Logs?',
  keywords: ['user logs', 'audit trail', 'activity log', 'history ng aksyon'],
  answer: `<p>This shows the history of each user's actions in the system — who logged in, made a sale, voided a transaction, approved/rejected a request, created a purchase order, etc. — for accountability and audit trail purposes. Normally, only the Admin has access here unless another role is given access.</p>`
},

{
  id: 'customers-add',
  category: 'Customers',
  question: 'How do I add a customer profile?',
  keywords: ['add customer', 'customer profile', 'bagong customer', 'register customer'],
  answer: `<p>In the <strong>Customers</strong> tab, click Add Customer and fill in the details (name, contact, email). You can also search for an existing customer.</p>`
},
{
  id: 'customers-loyalty-card',
  category: 'Customers',
  question: 'How do I issue a Loyalty Card or QR for a customer?',
  keywords: ['loyalty card', 'loyalty qr', 'issue card', 'regenerate card', 'card scan customer', 'lost loyalty card'],
  answer: `<p>Each customer can be given their own <strong>Loyalty Card or QR</strong> — this is what gets scanned at the POS Terminal to automatically attach the customer and pre-authorize their points redemption without needing a password.</p>
  <p>There are two types:</p>
  <ul>
    <li><strong>Static Card</strong> — a permanent QR/barcode that can be printed and placed on a physical card.</li>
    <li><strong>Rotating QR</strong> — the QR code changes periodically (e.g. shown on the customer's phone) for extra security against copying.</li>
  </ul>
  <p>Once a customer's card is regenerated, the old QR is automatically deactivated — only the new one will work. A card can also be revoked (cancelled) if it's lost or misused. Issuing/regenerating requires special access — not every role automatically has this ability.</p>`
},
{
  id: 'customers-debtors',
  category: 'Debtors',
  question: 'What is Debtors and how is it used?',
  keywords: ['debtors', 'utang', 'debtors ledger', 'due date', 'balance owed', 'c-credit', 'credit sale', 'partial payment'],
  answer: `<p><strong>Debtors</strong> is a ledger that tracks customers who have a <strong>balance owed</strong> — including the amount, sale date, and due date. It's part of the <strong>Customer Profiles, Loyalty &amp; Debtors</strong> premium module — unlocked together when that's purchased.</p>
  <p>It's usually entered in two ways:</p>
  <ul>
    <li>Via <strong>C-Credit</strong> as the payment method at POS Terminal checkout (this isn't actually paid yet — it automatically creates a new debt entry)</li>
    <li>Via the "Add Debt" form directly on the Debtors page</li>
  </ul>
  <p>Each debt record has the debtor's name (required), phone number, note, amount owed, and an optional due date. Its status is <strong>Unpaid</strong>, <strong>Partial</strong> (partially paid), or <strong>Paid</strong> — you can record partial payments until it's fully paid, and this automatically reduces the remaining balance.</p>
  <p>Once a debt is fully paid, the customer automatically earns loyalty points (if Loyalty is enabled). You also can't void a C-Credit transaction if a payment has already been recorded on its linked debt — the debt record needs to be fixed first.</p>`
},
{
  id: 'debtors-open-page',
  category: 'Debtors',
  question: 'Where do I find the Debtors page, and who can access it?',
  keywords: ['where is debtors', 'open debtors', 'debtors menu', 'debtors page', 'debtors tab', 'go to debtors'],
  answer: `<p>You'll find <strong>Debtors</strong> as its own item in the sidebar menu (with a hand-holding-money icon). It's part of the <strong>Customer Profiles, Loyalty &amp; Debtors</strong> premium module — if it's still locked (shown with a gray lock icon next to the menu), the module needs to be unlocked/purchased first before it can be used.</p>
  <p>Once unlocked, access still depends on the account's <strong>Roles &amp; Permissions</strong> — the role needs the "customers" permission to open Debtors, so not every cashier/staff account automatically has access unless it's been granted.</p>`
},
{
  id: 'debtors-add-manual',
  category: 'Debtors',
  question: 'How do I manually add a new debt record?',
  keywords: ['add debt', 'add a debt', 'new debt record', 'create debt record', 'manual debt entry', 'add debtor'],
  answer: `<p>On the Debtors page, click <strong>"Add Debt"</strong>, then fill in the form:</p>
  <ul>
    <li><strong>Debtor's Full Name</strong> — required</li>
    <li><strong>Phone Number</strong> — optional</li>
    <li><strong>Amount Owed (₱)</strong> — required, must be greater than 0</li>
    <li><strong>Note</strong> — optional (e.g. reason, when it was borrowed, etc.)</li>
    <li><strong>Due Date/Time</strong> — optional, when payment is expected</li>
  </ul>
  <p>Once saved, the new record starts with a status of <strong>Unpaid</strong> and ₱0 paid so far, and immediately appears at the top of the Debtors list.</p>`
},
{
  id: 'debtors-record-payment',
  category: 'Debtors',
  question: 'How do I record a payment on a debt?',
  keywords: ['record payment', 'pay off debt', 'partial payment debt', 'record a payment', 'pay debtor'],
  answer: `<p>In the Debtors list, click the <strong>green money icon</strong> (Record a payment) next to the debt you want to pay — this only shows up while the status isn't already <strong>Paid</strong>. Enter the amount paid, then confirm.</p>
  <ul>
    <li>The amount paid can't exceed the <strong>remaining balance</strong> — you'll get an error if you enter too much.</li>
    <li>If it's only a partial payment, the status becomes <strong>Partial</strong>.</li>
    <li>Once it's fully paid off, the status immediately becomes <strong>Paid</strong>, the paid date is recorded, and the customer automatically earns <strong>loyalty points</strong> if the Loyalty module is enabled.</li>
  </ul>
  <p>Every payment recorded is added to the debt's <strong>Payment Breakdown/History</strong> (date, amount, and who recorded it) — visible from the "View" button on each debt.</p>`
},
{
  id: 'debtors-edit-delete',
  category: 'Debtors',
  question: 'How do I edit or delete a debt record?',
  keywords: ['edit debt', 'delete debt', 'remove debt record', 'update debtor name', 'delete debtor'],
  answer: `<p><strong>To edit:</strong> click the pencil/edit icon next to the debt record — you can change the name, phone number, amount, note, and due date. If you change the amount to something equal to or less than what's already been paid, the status (Unpaid/Partial/Paid) automatically recalculates.</p>
  <p><strong>To delete:</strong> click the trash/delete icon — there's a confirmation step first since <strong>this can't be undone</strong> once deleted.</p>`
},
{
  id: 'debtors-status-duedate',
  category: 'Debtors',
  question: 'What do Unpaid/Partial/Paid mean, and how do I search or filter Debtors?',
  keywords: ['unpaid partial paid', 'debt status', 'overdue', 'due date countdown', 'search debtor', 'filter debtors'],
  answer: `<p>Every debt record has one of three statuses:</p>
  <ul>
    <li><strong>Unpaid</strong> — nothing has been paid yet</li>
    <li><strong>Partial</strong> — partially paid, with a remaining balance</li>
    <li><strong>Paid</strong> — fully paid off</li>
  </ul>
  <p>If a debt has a due date, you'll see a <strong>live countdown</strong> (e.g. "3d 2h remaining" or "Overdue by 5h 10m" once past the due date) that automatically refreshes every 30 seconds while the Debtors page is open.</p>
  <p>Above the list, there's a <strong>search box</strong> (searches by name or phone number) and a <strong>status filter</strong> (All, Unpaid, Partial, Paid, and Overdue — the "Overdue" filter shows anything not yet Paid that's already past its due date).</p>`
},
{
  id: 'debtors-ccredit-checkout',
  category: 'Debtors',
  question: 'How does C-Credit work as a payment method at the POS Terminal?',
  keywords: ['c-credit', 'credit sale checkout', 'pay on credit at pos', 'how to c-credit', 'sale on credit'],
  answer: `<p>At POS Terminal checkout, <strong>C-Credit</strong> is a payment method option — it isn't actual cash received right away; instead it automatically creates a new <strong>Debtors</strong> record for that sale.</p>
  <ul>
    <li>The <strong>Debtor's Full Name</strong> must be entered before the sale can be processed — it's required for a C-Credit sale.</li>
    <li>The new debt record automatically captures the sale amount, the items purchased, and the linked Transaction ID.</li>
    <li>Two different debt records can't be linked to the same Transaction ID — this can only happen once per transaction.</li>
  </ul>
  <p>The new record shows up on the Debtors page right after checkout, and from there it can be treated just like any manually-added debt (recording payments, editing, etc.).</p>`
},
{
  id: 'debtors-void-restriction',
  category: 'Debtors',
  question: "Why can't I void a C-Credit transaction?",
  keywords: ['why cant void', 'void c-credit', 'cannot void', 'void restriction debt', 'error voiding debt'],
  verdict: 'depende',
  answer: `<p>If a transaction was paid using <strong>C-Credit</strong> and a <strong>payment</strong> (partial or full) has already been recorded against its linked debt, it can no longer be voided directly — you'll get a warning message stating how much has been paid and which debt record it's linked to.</p>
  <p>You'll need to fix the <strong>debt record</strong> on the Debtors page first (e.g. adjusting the recorded payments via edit, or checking with the admin) before the original transaction can be voided — this is meant to prevent mismatches between sales records and the debt that's already been logged.</p>`
},
{
  id: 'debtors-receipt-share',
  category: 'Debtors',
  question: 'How do I print, email, or share a receipt for a debt?',
  keywords: ['print debt receipt', 'email debt receipt', 'e-receipt debtor', 'download debt receipt', 'share debt receipt'],
  answer: `<p>Open the <strong>"View"</strong> button on a debt record to see its full details, where there are two options at the bottom:</p>
  <ul>
    <li><strong>Print Receipt</strong> — prints a receipt directly (including the debt details, payment history, and items purchased).</li>
    <li><strong>E-Receipt</strong> — opens a preview that can be:
      <ul>
        <li><strong>emailed</strong> directly to an email address (requires an active internet connection),</li>
        <li><strong>downloaded</strong> as an image, or</li>
        <li><strong>shared</strong> using the device's built-in share menu.</li>
      </ul>
    </li>
  </ul>
  <p>The E-Receipt automatically follows the device's current light/dark theme when previewed, and it's downloaded/shared as an image with whichever colors are showing at that moment.</p>`
},

{
  id: 'receipt-customize',
  category: 'Receipt Settings',
  question: 'How do I customize the store name/address/contact on the receipt?',
  keywords: ['receipt customization', 'store name', 'edit resibo', 'header footer resibo', 'paper size'],
  answer: `<p>Go to <strong>Receipt Settings</strong>. There you can change the Store Name, Store Address, Store Contact, Header Text, Footer Text, and Paper Size (58mm/80mm).</p>
  <p>There are <strong>2 FREE customizations</strong> (not counting Paper Size since that's just a hardware setting). After the 2 free attempts are used up, <strong>OTP (One-Time Password/Code) verification</strong> is required before you can save a new change.</p>`
},
{
  id: 'receipt-logo-header',
  category: 'Receipt Settings',
  question: 'Can I put a logo on the receipt instead of just text?',
  keywords: ['logo sa resibo', 'header image', 'store logo', 'larawan sa resibo', 'upload logo'],
  verdict: 'oo',
  answer: `<p>Yes — besides a simple text header, you can now upload a <strong>logo/image</strong> as the receipt header instead of just text, with an option for its alignment (left/center/right) at the top of the receipt.</p>`
},
{
  id: 'receipt-double-copy',
  category: 'Receipt Settings',
  question: 'Can I print two copies of the receipt at once?',
  keywords: ['double copy', 'dalawang kopya resibo', 'two copies receipt', 'print twice'],
  verdict: 'oo',
  answer: `<p>Yes — in the Advanced section of Receipt Customization, you can turn on <strong>Double Copy</strong> to automatically print two consecutive copies of the same receipt (e.g. one for the customer, one for the store's file) on every sale, with its own setting for the spacing between the two copies.</p>`
},
{
  id: 'receipt-loyalty-qr-position',
  category: 'Receipt Settings',
  question: 'Where does the loyalty QR code go on the receipt?',
  keywords: ['loyalty qr resibo', 'qr position', 'qr code sa resibo'],
  answer: `<p>If Loyalty Points is enabled, you can set where the customer's loyalty QR code goes on the receipt — above or below the transaction barcode.</p>`
},
{
  id: 'receipt-modern-template',
  category: 'Receipt Settings',
  question: 'Is there a narrow receipt format option for other types of printers?',
  keywords: ['modern template', 'makitid na resibo', 'narrow receipt', 'compact receipt format'],
  verdict: 'oo',
  answer: `<p>Yes — there's an alternative receipt format that follows the narrower size used by certain thermal printers, which can be customized from 40mm to 80mm wide. It's OFF by default and optional.</p>`
},
{
  id: 'receipt-transaction-id-format',
  category: 'Receipt Settings',
  question: 'Can I change the format of the Transaction ID?',
  keywords: ['transaction id format', 'palitan format id', 'short transaction id'],
  verdict: 'oo',
  answer: `<p>Yes — you can now choose the Transaction ID format used on receipts and in the Transactions tab, depending on the business's preference.</p>`
},
{
  id: 'receipt-gmail-app-password',
  category: 'Receipt Settings',
  question: 'Why is a Gmail App Password needed in Receipt Settings?',
  keywords: ['gmail app password', 'otp sender', 'why gmail password', 'app password setup'],
  answer: `<p>The Gmail account (along with its <strong>App Password</strong> — not your personal password) is used to automatically send OTP emails whenever verification is needed (receipt customization after the 2 free attempts, Pro theme unlock, or factory reset backup).</p>
  <p><strong>Security note:</strong> The App Password is never shown back to you — only part of the configured email is shown (e.g. ma***@gmail.com) just to confirm the correct one was saved.</p>`
},
{
  id: 'receipt-otp-flow',
  category: 'Receipt Settings',
  question: 'How does OTP (One-Time Password/Code) verification work?',
  keywords: ['otp', 'one time password', 'one time code', 'verification code'],
  answer: `<p>The <strong>OTP</strong> is a 6-digit random code that:</p>
  <ol>
    <li>When requested (e.g. Receipt Customization after 2 free attempts), generates a new code that is valid only for <strong>10 minutes</strong>.</li>
    <li>Is sent to the <strong>registered email of the system's owner/developer</strong> — not to the user requesting it.</li>
    <li>You enter the code you received to "unlock" the action (save receipt settings, unlock a Pro theme, etc.).</li>
    <li>The code can only be used once, and automatically expires after 10 minutes.</li>
  </ol>`
},
{
  id: 'themes-pro',
  category: 'Themes',
  question: 'How do I unlock a Pro Theme?',
  keywords: ['pro theme', 'unlock theme', 'ocean pro', 'emerald pro', 'sunset pro', 'rosegold', 'cyber neon', 'coffee noir', 'mint frost', 'galaxy ambient', 'liquid glass', 'bayad theme'],
  answer: `<p>In the Themes menu, there are nine (9) Pro Themes to choose from (Ocean, Emerald, Sunset, Rose Gold, Cyber Neon, Coffee Noir, Mint Frost, Galaxy Ambient, and Liquid Glass), each with its own color palette. All are priced the same — ₱149 each.</p>
  <ol>
    <li>Request an unlock — this sends an OTP to the email of the system's owner/developer.</li>
    <li>Once the OTP is confirmed, that theme is permanently unlocked for your system.</li>
  </ol>
  <p>After unlocking one or more, you can freely switch between all of your unlocked themes at any time.</p>`
},

{
  id: 'premium-features-list',
  category: 'Premium Features',
  question: 'What premium modules does OmniPOS have?',
  keywords: ['premium features', 'paid modules', 'bayad na module', 'unlock feature', 'gembang icon', 'pro badge'],
  answer: `<p>Besides Pro Themes, OmniPOS also has full modules locked as premium features until unlocked: Purchase Orders Module, Customer Profiles & Loyalty, Promo Codes Module, Sales Analytics & Advanced Reports, Multi-Cashier Shift Oversight & Z-Reading, Roles & Permissions (RBAC) Management, Multi-Branch Dashboard, and the new <strong>OmniPOS AI Assistant</strong>.</p>
  <p>When you try to use a locked feature, its details (name, price, short explanation) appear along with the option to request an unlock.</p>
  <p><strong>Note:</strong> four of these are now <strong>subscriptions (monthly or yearly)</strong> instead of a one-time purchase — Cloud Backup, RBAC Management, Multi-Branch Dashboard, and AI Assistant. The rest of the modules/themes are still one-time purchases, permanently unlocked. See the dedicated FAQ on subscription modules for details.</p>`
},
{
  id: 'premium-bundle-tiers',
  category: 'Premium Features',
  question: 'Are there bundles or packages for premium features instead of buying them one by one?',
  keywords: ['bundle', 'upgrade tier', 'package ng features', 'basic standard pro upgrade', 'sabay-sabay na bumili'],
  verdict: 'oo',
  answer: `<p>Yes — instead of buying one at a time, there are prepared packages that are cheaper than buying the covered modules individually:</p>
  <ul>
    <li><strong>Basic Upgrade</strong> — Sales Analytics & Advanced Reports + Promo Codes Module.</li>
    <li><strong>Standard Upgrade</strong> — everything in Basic, plus Customer Profiles & Loyalty and Multi-Cashier Shift Oversight.</li>
    <li><strong>Pro Upgrade (Complete)</strong> — EVERY other module AND EVERY Pro Theme — nothing left locked, <strong>EXCEPT</strong> Cloud Backup, Roles & Permissions (RBAC) Management, Multi-Branch Dashboard, and AI Assistant, since these are billed separately as their own subscription (monthly/yearly) and are not included in these bundle/upgrade tiers.</li>
  </ul>
  <p>If you've already purchased individual features that are included in a tier, the price of that bundle is automatically reduced so you don't pay again for the same feature.</p>`
},
{
  id: 'premium-demo-mode',
  category: 'Premium Features',
  question: 'Can I try premium features before buying?',
  keywords: ['demo mode', 'try demo', 'libreng subok', 'free trial', 'subukan bago bumili', 'trial period'],
  verdict: 'oo',
  answer: `<p>Yes — through <strong>Demo Mode</strong>, you can try ALL premium modules and Pro Themes for FREE for a limited time (usually 24 hours, though the developer/owner may set a different duration when approving the request).</p>
  <ol>
    <li>On the Premium Features page, request the Demo — the request is sent to the system's developer/owner.</li>
    <li>Once approved, you'll receive an OTP code — enter it to immediately activate Demo Mode.</li>
    <li>While active, you can use all premium modules and Pro Themes for free, until the set duration expires (or until the Admin ends it early).</li>
  </ol>
  <p>If you've already actually purchased a feature before or during a demo, it's unaffected — it stays permanently unlocked even after the demo ends.</p>`
},
{
  id: 'premium-cloud-backup',
  category: 'Premium Features',
  question: 'What is Cloud Backup and how much does it cost?',
  keywords: ['cloud backup', 'online backup', 'postgres backup', 'backup sa cloud'],
  answer: `<p>Cloud Backup is now a <strong>subscription module</strong> (monthly or yearly, NOT a one-time purchase anymore) that syncs the entire database — all modules, including user accounts (but NOT passwords) — to secure online storage, to protect your data in case the device is damaged or lost.</p>
  <p>There are three tiers: <strong>Basic, Standard, and Pro</strong> — pricing varies depending on the tier and billing cycle (monthly/yearly) you choose. Once subscribed, there's a button to back up manually and to restore from the latest cloud backup. It also uses <strong>Cloud Tokens</strong> for each actual sync/restore — see the dedicated FAQ on Cloud Tokens.</p>`
},
{
  id: 'premium-module-subscriptions',
  category: 'Premium Features',
  question: 'How does the subscription for RBAC, Multi-Branch, and AI Assistant work?',
  keywords: ['module subscription', 'buwanang bayad', 'monthly yearly subscription', 'rbac subscription', 'multi branch subscription', 'grace period', 'nag expire subscription'],
  answer: `<p><strong>Roles & Permissions (RBAC) Management</strong>, <strong>Multi-Branch Dashboard</strong>, and <strong>OmniPOS AI Assistant</strong> are no longer one-time purchases — they're <strong>subscriptions</strong> now, billed monthly or yearly (yearly is cheaper per month).</p>
  <ul>
    <li>While the subscription is active, the full feature is available.</li>
    <li>If it expires without renewal, there's a <strong>7-day grace period</strong> before the feature is locked again — enough time to renew without an abrupt interruption.</li>
    <li>After the grace period passes, the feature locks again until renewed.</li>
  </ul>
  <p>This is separate from the one-time modules/themes (Purchase Orders, Promo Codes, Customer CRM, etc.) — those remain permanently unlocked once purchased.</p>`
},
{
  id: 'premium-ai-assistant',
  category: 'Premium Features',
  question: 'What is the OmniPOS AI Assistant and how is it different from the old FAQ search?',
  keywords: ['ai assistant', 'artificial intelligence', 'ai chatbot', 'cloudflare workers ai', 'smart faq', 'ai sa faq'],
  answer: `<p>The <strong>OmniPOS AI Assistant</strong> is an advanced help assistant embedded right inside the FAQ page. Instead of just matching exact keywords like the old search, a real AI model reads and understands your question, then answers in natural Tagalog/English based on the OmniPOS FAQ Knowledge Base.</p>
  <ul>
    <li>Its ONLY source of answers is the system's FAQ Knowledge Base — it's not a free-roaming chatbot that answers anything.</li>
    <li>It needs to be unlocked first as a subscription module (monthly/yearly) before it works.</li>
    <li>If it's still locked, or if the AI request times out/fails, it automatically falls back to the old keyword-based FAQ search — the FAQ page never stops working.</li>
  </ul>`
},
{
  id: 'premium-multi-branch-usage',
  category: 'Premium Features',
  question: 'How does the Multi-Branch Dashboard on the Overview page work?',
  keywords: ['all branches', 'multi branch dashboard usage', 'ibang branch data', 'business group code', 'branch name setup', 'combine branches'],
  answer: `<p>Once <strong>Multi-Branch Dashboard</strong> is unlocked, an "All Branches" section appears on the Overview page that combines sales, transaction count, and low-stock snapshots from ALL branches of the business (different devices/locations) — near real-time, updated every few minutes via Relay.</p>
  <p>For this to work, you first need to set the <strong>Branch Name</strong> (e.g. "Main Branch", "Branch 2 - Cubao") and the <strong>Business Group Code</strong> in Store Settings — use the SAME Business Group Code on EVERY branch you want combined into one view.</p>`
},

{
  id: 'system-forgot-admin-password',
  category: 'System Reset',
  question: 'I forgot my admin password, how do I reset it?',
  keywords: ['forgot password', 'nakalimutan password', 'reset admin password', 'lost password'],
  answer: `<p>There are now two ways:</p>
  <p><strong>1. Self-Service Password Reset (recommended)</strong> — on the Login screen, choose the "Forgot Admin Password" option. The request is sent for approval to the system's developer/owner. Once approved, you'll receive an OTP code — enter it along with a new password (at least 8 characters) to immediately update the Admin password, <strong>WITHOUT needing to erase any other data</strong>. This requires an active internet connection.</p>
  <p><strong>2. System Reset (Hard Factory Reset)</strong> — if the first method isn't available, the alternative is a Hard Factory Reset, which requires the Gmail App Password to already be set up in Receipt Settings before it can be used. When this is used: the full data backup is sent to your email first before data is erased, then user accounts are restored to the default set of accounts.</p>
  <p><strong>Important reminder:</strong> You need access to an Admin account (any Admin) first to trigger the Hard Reset.</p>`
},
{
  id: 'system-reset-full',
  category: 'System Reset',
  question: 'What happens when a System Reset / Factory Reset is done?',
  keywords: ['factory reset', 'system reset', 'hard reset', 'clear all data', 'burahin lahat ng data'],
  answer: `<p>The <strong>Hard Factory Reset</strong> is an ADMIN-ONLY action, and here's the sequence of what happens:</p>
  <ol>
    <li>A <strong>COMPLETE backup</strong> of every data module in the system is collected — this includes users, products, transactions, refunds, logs, requests, categories, customers, debts, promo codes, purchase orders, low-stock tracking, shifts, loyalty security data, and Fraud & Anomaly Alerts.</li>
    <li>This backup is sent to your email first — <strong>if the email fails</strong> (e.g. wrong app password), <strong>the entire reset is stopped</strong> and your data remains SAFE.</li>
    <li>Once the email succeeds, only then does the erasing happen: users revert to the default set of accounts, and all business/transactional data is deleted — products, transactions, refunds, requests, customers, debts, promo codes, purchase orders, low-stock tracking, shifts, shift records, user activity logs, loyalty card security data, and Fraud & Anomaly Alerts (including the live fraud-velocity counters used for detection) — while categories revert to the default set.</li>
  </ol>
  <p><strong>Deliberately left untouched:</strong> the count of FREE receipt customizations, plus device identity/license data (installation ID, hardware fingerprint, device verification, Relay authorization) and system configuration (Store Settings, UX Settings, Receipt Settings, Advanced Settings, Roles & Permissions, Connectivity Mode) — so Factory Reset can't be used just to get the 2 free attempts back, and the device doesn't lose its identity or configuration.</p>`
},
{
  id: 'system-restore-backup',
  category: 'System Reset',
  question: 'How do I restore from a backup file?',
  keywords: ['restore backup', 'ibalik ang backup', 'import backup file', 'recover data'],
  answer: `<p>In the Restore Backup feature, you need the Admin username, password, and the backup file (from a previous Factory Reset email or a manual export). Once the admin credentials are verified, <strong>every data module found in that backup file</strong> is synced back into the system — this covers users, products, transactions, refunds, user logs, requests, categories, carts, customers, debts, promo codes, purchase orders, low-stock tracking, shifts, loyalty security data, and Fraud & Anomaly Alerts, plus any other module present in the file.</p>`
},

{
  id: 'requests-approval',
  category: 'Staff Requests',
  question: 'What are Staff Requests and how are they approved?',
  keywords: ['staff requests', 'pending approval', 'approve reject', 'request approval'],
  answer: `<p>When the Admin sets that a role needs approval first for a particular action ("Direct Apply" set to OFF), that action is <strong>not applied immediately</strong>. Instead, it goes into <strong>Staff Requests</strong> as PENDING.</p>
  <p>This includes: adding/editing a product, Quick Restock, editing your own profile, Receipt Customization, Store & Sales Settings, Appearance/UX Settings, and Advanced Settings — depending on what the Admin has set in the Permission Matrix for each role.</p>
  <p>Only the Admin can approve or reject this. Once approved, the change is only then actually applied, and the whole decision is logged (including who approved/rejected it).</p>`
},

{
  id: 'security-overview',
  category: 'Security',
  question: 'What protections does OmniPOS have for data and accounts?',
  keywords: ['security', 'seguridad', 'proteksyon', 'ligtas ba ang data', 'safe ba'],
  verdict: 'oo',
  answer: `<p>Some of OmniPOS's built-in protections:</p>
  <ul>
    <li><strong>Passwords are encrypted</strong> — they are not stored in plain/readable form.</li>
    <li><strong>A valid login is required</strong> before any part of the system can be used — there's no direct access that bypasses login.</li>
    <li><strong>Failed attempts are limited</strong> (login, void, password reset, OTP, factory reset) — to prevent repeated guessing of a password or code.</li>
    <li><strong>Role-based access</strong> — this is enforced throughout the system, not just in how the menu looks, and it's now more detailed (granular) in what can be set.</li>
    <li><strong>Admin password required</strong> (or the password of an authorized role, if permitted) for risky actions like voiding, refunding, manual discounts, and restoring a backup.</li>
    <li>Upload file size is limited, so the system can't be abused.</li>
  </ul>`
},
{
  id: 'security-database',
  category: 'Security',
  question: 'Where is OmniPOS\'s data stored?',
  keywords: ['saan naka store data', 'database file', 'nasaan ang datos'],
  answer: `<p>All data (users, products, transactions, logs, requests, categories, customers, promo codes, shifts, purchase orders, etc.) is safely and properly stored in one place within the system. That's why making a backup is simple — only one file needs to be saved.</p>`
},
{
  id: 'security-2fa',
  category: 'Security',
  question: 'What is Two-Factor Authentication (2FA) for login?',
  keywords: ['2fa', 'two factor authentication', 'otp sa login', 'dagdag na security login', 'email otp login'],
  answer: `<p>When enabled in Settings → Advanced Settings, a <strong>6-digit OTP code</strong> (sent to a configured email) will be required every time someone logs in — not just username and password, there's an extra step before getting in.</p>
  <p>This is opt-in — the Admin decides whether to enable it and which email address the OTP codes are sent to.</p>`
},
{
  id: 'security-fraud-detection',
  category: 'Security',
  question: 'What is Fraud & Anomaly Detection?',
  keywords: ['fraud detection', 'anomaly alert', 'fraud alerts', 'kaduda-dudang transaksyon', 'fraud sensitivity'],
  answer: `<p>When enabled in Settings → Advanced Settings, the system automatically monitors for suspicious activity patterns (e.g. rapid, repeated voids/refunds in a short time) and creates a <strong>Fraud & Anomaly Alert</strong> when one is detected.</p>
  <ul>
    <li>There's a "sensitivity" setting (low/medium/high) that determines how quickly it triggers an alert.</li>
    <li>There's also an option to immediately email a notification to a configured address when a new alert comes in.</li>
    <li>All alerts can be viewed in the Fraud Alerts table inside the Settings/Users tab (Admin access).</li>
  </ul>`
},

{
  id: 'system-update-check',
  category: 'System Updates',
  question: 'How do I know if there\'s a new version of OmniPOS and how do I update it?',
  keywords: ['check update', 'check for updates', 'bagong bersyon', 'paano mag update', 'update ng system', 'may update ba', 'i-update ang omnipos', 'deploy update', 'new version'],
  answer: `<p>Go to <strong>Settings → System Update</strong> (Admin access only). There:</p>
  <ol>
    <li>Click <strong>"Check for Updates"</strong> to find out if a new version of OmniPOS is available — you'll see your current version and the latest available version.</li>
    <li>If there's a new version, a <strong>"Deploy Update Now"</strong> button appears — click it to automatically apply the update to your system.</li>
  </ol>
  <p><strong>Note:</strong> The update process is safe — your data (products, transactions, users, etc.) won't be lost during the update.</p>`
},
{
  id: 'update-new-modules',
  category: 'System Updates',
  question: 'What new functions or modules have been added to OmniPOS?',
  keywords: ['bagong module', 'bagong function', 'malaking update', 'new modules', 'major update', 'mga bagong feature ngayon'],
  answer: `<p>Some of OmniPOS's newest added capabilities:</p>
  <ul>
    <li><strong>Refund (Full/Partial)</strong> — returning a customer's payment without cancelling the whole transaction.</li>
    <li><strong>Manual Discount</strong> in the cart — directly reducing the amount without a promo code.</li>
    <li><strong>More granular Permission Matrix</strong> — including the "own password" option for certain sensitive actions.</li>
    <li><strong>AI Bulk Image Search</strong> — automatic photo search for many products at once.</li>
    <li><strong>Quick Restock</strong> — quickly adding stock without creating a full Purchase Order.</li>
    <li><strong>Loyalty Card/QR</strong> (Static or Rotating) for customers.</li>
    <li><strong>Self-Service Forgot Admin Password</strong> — no more need for a Hard Reset if you just forgot your password.</li>
    <li><strong>Demo Mode</strong> and <strong>Bundle/Upgrade Tiers</strong> for premium features.</li>
    <li>Additional Receipt Customization options — logo header, double-copy printing, loyalty QR position, and a narrow (Modern) format.</li>
  </ul>
  <p>This is always updated whenever there are new changes to the system.</p>`
},
{
  id: 'update-latest-changes',
  category: 'System Updates',
  question: 'What\'s new or changed in OmniPOS?',
  keywords: ['bago', 'update', 'updates', 'changelog', 'ano ang bago', 'whats new', "what's new", 'latest changes', 'nabago sa system', 'recent changes', 'bagong feature', 'anong nabago'],
  answer: `<p>Here are the latest changes to OmniPOS's interface:</p>
  <ul>
    <li><strong>Improved Profile menu:</strong> the user profile dropdown (above the sidebar) now automatically closes when another menu is opened, when you click outside of it, or when you scroll — so it no longer overlaps with other dropdowns.</li>
    <li><strong>Profile dropdown no longer overflows the edge:</strong> its height is now limited based on screen size, so if the list is long (e.g. many Active Users), it scrolls within the dropdown itself instead of spilling off to the side.</li>
    <li><strong>Page title moves to the Header on Tablet/Phone:</strong> when using the system on a tablet or phone, each page's title (e.g. Dashboard, Products, FAQ) now appears at the top Header — near the notification bell — instead of inside the page itself, for a less cramped view on small screens.</li>
  </ul>
  <p>This is always updated whenever there are new changes to the system — check back here from time to time for the latest information.</p>`
},
{
  id: 'update-profile-dropdown-behavior',
  category: 'System Updates',
  question: 'Why does the Profile dropdown in the sidebar close automatically?',
  keywords: ['profile dropdown', 'user dropdown', 'nagsasara profile menu', 'dropdown auto close', 'profile menu closing', 'sidebar dropdown', 'nakalabas dropdown', 'sumosobra sa sidebar'],
  answer: `<p>This new behavior of the Profile dropdown (avatar/username above the sidebar) is intentional for a cleaner, less confusing view:</p>
  <ul>
    <li>When another menu/dropdown is opened, any other open dropdown is automatically closed first — only one dropdown is open at any time.</li>
    <li>When you click anywhere outside the dropdown, or navigate to another page/view, it closes immediately.</li>
    <li>When you scroll while the dropdown is open, it also closes immediately.</li>
    <li>The dropdown's maximum height is now also limited based on screen size, so it no longer "spills out" of the sidebar when its contents are long — it scrolls within the dropdown itself instead.</li>
  </ul>`
},
{
  id: 'update-mobile-header-title',
  category: 'System Updates',
  question: 'Why is the page title in the Header when using a tablet or phone?',
  keywords: ['page title header', 'title sa header', 'mobile title', 'tablet title', 'title bumabago pwesto', 'dashboard title header', 'title malapit sa bell', 'responsive title', 'font size title'],
  verdict: 'depende',
  answer: `<p>This depends on the screen size/width of the device being used:</p>
  <ul>
    <li><strong>On Tablet or Phone</strong> (small screen), the title of the current page — e.g. <em>Dashboard, Products, Barcode Generator, Reorder Alerts, Sales Analytics, Transaction, Customers, Shift/Z-Reading, System Audit Logs, FAQ</em> — moves to the top Header, right next to the notification bell, instead of inside the page itself, for a less cramped view on small screens.</li>
    <li><strong>On PC or Laptop</strong> (large screen), each title stays in its ORIGINAL place — inside the page/view itself, not the Header — as before.</li>
  </ul>
  <p>This also automatically adjusts when you resize the browser window or rotate the tablet/phone (portrait/landscape).</p>`
},

{
  id: 'cloud-tokens-what',
  category: 'Cloud Tokens & Payments',
  question: 'What are Cloud Tokens and what are they used for?',
  keywords: ['cloud tokens', 'ano ang tokens', 'token wallet', 'bumili ng tokens', 'sync token', 'restore token'],
  answer: `<p><strong>Cloud Tokens</strong> work like "load" or an e-wallet balance used to pay for each actual <strong>Cloud Backup sync or restore</strong> — instead of waiting for a monthly bill, tokens are deducted each time the feature is used, based on your Cloud Backup tier (Basic/Standard/Pro).</p>
  <ul>
    <li>You buy a package of tokens (e.g. via GCash/Maya/card, depending on the configured payment method), which is added to your wallet.</li>
    <li>The Cloud Backup section shows your current token balance and how much each sync/restore will cost.</li>
    <li>If tokens run out, the next sync/restore can't be performed until you buy more tokens.</li>
  </ul>`
},
{
  id: 'payment-methods',
  category: 'Cloud Tokens & Payments',
  question: 'What payment methods are accepted for buying a feature/tokens?',
  keywords: ['paano magbayad', 'gcash', 'maya', 'paymaya', 'credit card', 'debit card', 'paypal', 'online banking', 'over the counter', 'payment options', 'bayad'],
  verdict: 'depende',
  answer: `<p>This depends on which payment provider your developer/system owner has configured — only the payment methods that are actually set up will automatically appear as options (not all of these are always available):</p>
  <ul>
    <li><strong>GCash / Maya / Online Banking</strong> (QR Ph) — via PayMongo or Xendit.</li>
    <li><strong>GrabPay and Bank Transfer</strong> — via Xendit.</li>
    <li><strong>Credit/Debit Card (international)</strong> — via Stripe.</li>
    <li><strong>PayPal</strong> — direct PayPal account.</li>
    <li><strong>Over-the-Counter</strong> (7-Eleven, Cebuana Lhuillier, LBC, etc.) and InstaPay/PESONet Bank Transfer — via Dragonpay.</li>
  </ul>
  <p>If no provider is configured at all, no online payment option will appear — in that case, reach out directly to the developer/system owner to arrange the unlock request.</p>`
},

{
  id: 'advanced-customer-display',
  category: 'Advanced Settings',
  question: 'What is the Customer-Facing Display and how do I open it?',
  keywords: ['customer display', 'second screen', 'pantalya ng customer', 'monitor ng customer', 'facing screen', 'ikalawang screen'],
  answer: `<p>The <strong>Customer-Facing Display</strong> is a second screen (monitor or tablet facing the customer) that live-mirrors the cart as the cashier rings up items, and shows a thank-you screen after each sale.</p>
  <ol>
    <li>In Settings → Advanced Settings, enable "Customer-Facing Display".</li>
    <li>You can also set a "compact threshold" — once the cart has more line items than this number, the display automatically shrinks the rows so everything, including the Total, still fits without needing to scroll.</li>
    <li>Click "Open Customer Display" — this opens a new window/tab that you can move to a second monitor or a separate tablet.</li>
  </ol>`
},
{
  id: 'advanced-idle-lock',
  category: 'Advanced Settings',
  question: 'What is Idle-Session Auto-Lock?',
  keywords: ['idle lock', 'auto lock', 'awtomatikong lock', 'walang galaw lock', 'auto lock minutes'],
  answer: `<p>When enabled in Settings → Advanced Settings, the session automatically locks (you'll need to verify again to get back in) after there's no activity (no click/type/touch) for a set number of minutes, which you configure yourself.</p>
  <p>This is opt-in only — it doesn't change the 8-hour session timeout for the whole login; it's a separate protection against someone seeing an unattended, logged-in screen.</p>`
},
{
  id: 'advanced-sale-webhook',
  category: 'Advanced Settings',
  question: 'What is the Sale Webhook and what is it for?',
  keywords: ['sale webhook', 'webhook', 'zapier', 'make integration', 'accounting integration', 'i-connect sa ibang app'],
  answer: `<p>The <strong>Sale Webhook</strong> is an opt-in integration that automatically sends the details of every completed sale to another tool outside OmniPOS — e.g. Zapier, Make, or accounting software — via a webhook URL.</p>
  <p>In Settings → Advanced Settings, enable the Sale Webhook, then enter the full <code>http://</code> or <code>https://</code> URL provided by the other app/tool. The setting won't be accepted if there's no valid URL entered before enabling.</p>`
},

{
  id: 'settings-store-sales',
  category: 'Store & Appearance Settings',
  question: 'What can be configured in Store & Sales Settings?',
  keywords: ['store settings', 'sales settings', 'currency', 'tax setting', 'senior citizen discount', 'pwd discount', 'loyalty earn rate', 'accepted payment methods'],
  answer: `<p>In Settings → Store & Sales, you can configure:</p>
  <ul>
    <li><strong>Currency</strong> and <strong>Tax</strong> (enable/disable, tax label, tax rate %, whether tax is already included in product prices).</li>
    <li><strong>Accepted Payment Methods</strong> that appear as options at POS Terminal checkout (Cash, GCash, Maya, Card, Bank Transfer) — separate from the payment providers (PayMongo/Xendit/etc.) used for buying premium features/Cloud Tokens.</li>
    <li><strong>GCash/Maya QR codes</strong> shown to the customer in the Payment modal for scanning.</li>
    <li><strong>Senior Citizen / PWD Discount</strong> (enable and set the discount rate).</li>
    <li><strong>Loyalty Points</strong> — enable earn/redeem, set the earn rate (₱ spent per 1 point) and redeem value (₱ discount per 1 point).</li>
    <li><strong>Branch Name</strong> and <strong>Business Group Code</strong> — for the Multi-Branch Dashboard (see the dedicated FAQ).</li>
  </ul>`
},
{
  id: 'settings-appearance-ux',
  category: 'Store & Appearance Settings',
  question: 'What can be configured in Appearance & UX Settings?',
  keywords: ['appearance settings', 'ux settings', 'dark mode', 'low stock threshold', 'scanner sound', 'dashboard widgets', 'swap terminal layout'],
  answer: `<p>In Settings → Appearance & UX, you can configure (each of these settings is <strong>per-device</strong>, not the same across every device):</p>
  <ul>
    <li><strong>Dark Mode</strong> as the default for this device.</li>
    <li><strong>Low-Stock Alert Threshold</strong> (number of units before it's flagged as low stock).</li>
    <li><strong>Barcode Scanner Sound Feedback</strong> — a sound when a scan succeeds.</li>
    <li><strong>Swap Order Cart / Product List Position</strong> at the POS Terminal (Desktop only, this device only) — you can also drag the "Order" header to the right as an alternative way to do this.</li>
    <li><strong>Dashboard Widgets</strong> to show — Sales Today, Low Stock, Top Products, Recent Transactions.</li>
  </ul>`
},

{
  id: 'inventory-supplier',
  category: 'Inventory',
  question: 'How do I use the Supplier field on a product?',
  keywords: ['supplier', 'distributor', 'purchase order', 'reorder'],
  answer: `<p><strong>Supplier</strong> is an optional text field on each product (in Products/Inventory) — it isn't a separate "Suppliers" master list, just a free-text field you type in (e.g. the distributor or supplier's name).</p>
  <p>It's used to:</p>
  <ul>
    <li>Show which supplier a product came from right in the Inventory list and in CSV export/import</li>
    <li>Pre-fill the "Supplier" field when creating a <strong>Purchase Order</strong> (part of the Purchase Orders premium module) — low-stock products are automatically suggested for reorder</li>
  </ul>
  <p>You can leave it blank if you don't track a specific supplier.</p>`
},
{
  id: 'roles-cashier-account',
  category: 'Roles & Permissions',
  question: 'What access does a Cashier account have?',
  keywords: ['cashier account', 'cashier role', 'cashier access', 'staff account', 'default role', 'cashier permissions', 'what can a cashier do'],
  answer: `<p><strong>Cashier</strong> is one of the 3 default roles (along with Admin and Staff) that comes built into the system automatically. Its default access is the <strong>most restricted</strong> — access to only:</p>
  <ul>
    <li><strong>POS Terminal</strong> (checkout/sales)</li>
  </ul>
  <p>It has no access to the Dashboard, Products/Inventory, Reports, Users, Logs, Customers, shift report amounts, or Settings — so cashiers can't see sensitive things like sales totals or profit.</p>
  <p>If the <strong>Roles &amp; Permissions (RBAC)</strong> premium module is unlocked, you can customize the exact permissions of the Cashier role (or create a new custom role) under Users → Roles &amp; Permissions.</p>`
},
{
  id: 'inventory-valuation',
  category: 'Inventory',
  question: 'Is there an inventory valuation report (total value of stock on hand)?',
  keywords: ['inventory valuation', 'stock value', 'total cost of stock', 'value of inventory'],
  verdict: 'hindi',
  answer: `<p>There's no dedicated "Inventory Valuation Report" yet that directly gives you the total value (₱) of all stock currently on hand.</p>
  <p>What is available:</p>
  <ul>
    <li>Every product has a <strong>Cost Price</strong> and <strong>Stock</strong> field, visible in the Inventory list and exportable via CSV — you can multiply (Cost × Stock) in the export to get a manual valuation</li>
    <li><strong>Reports</strong> gives you estimated profit (Revenue − Cost of Goods Sold) based on items already SOLD, not on total stock on hand</li>
  </ul>
  <p>If you need this as a built-in report, we'd suggest raising it with your developer/admin as a feature request.</p>`
},
{
  id: 'inventory-product-variants',
  category: 'Inventory',
  question: 'Are product variants supported (e.g. different sizes or colors of one product)?',
  keywords: ['product variants', 'size variant', 'color variant', 'variant'],
  verdict: 'hindi',
  answer: `<p>OmniPOS doesn't have a built-in "variant" system yet (one parent product with multiple size/color/flavor options).</p>
  <p>The workaround most users use: create a <strong>separate product code</strong> for each variant (e.g. "Shirt-Red-M", "Shirt-Red-L", "Shirt-Blue-M"), each with its own barcode, price, and stock count. You can use the same <strong>Category</strong> to keep them grouped together in the Inventory list and reports.</p>`
},
{
  id: 'transactions-discounts-promo',
  category: 'Discounts & Promo Codes',
  question: 'What kinds of discounts are supported at checkout?',
  keywords: ['discount', 'promo code', 'senior discount', 'pwd discount', 'manual discount', 'loyalty discount'],
  answer: `<p>There are 4 kinds of discounts at POS Terminal checkout:</p>
  <ul>
    <li><strong>Senior Citizen / PWD Discount</strong> — requires a valid Senior/PWD ID Number; the percentage is configured in Store &amp; Sales Settings</li>
    <li><strong>Promo Code</strong> (premium module) — a percent (%) or fixed (₱) discount, can have an expiry date and minimum spend requirement, and can be enabled/disabled anytime without deleting it</li>
    <li><strong>Manual Discount</strong> — a direct amount (₱) entered by the cashier/admin on the cart</li>
    <li><strong>Loyalty Points Redemption</strong> — uses the customer's accumulated points as a discount, based on the configured "₱ value per point" in Settings</li>
  </ul>
  <p>Only one of these can be used per transaction (they can't be combined), separate from per-item discounts which can also be applied to individual products in the cart.</p>`
},
{
  id: 'roles-employee-management',
  category: 'Roles & Permissions',
  question: 'How do I manage employee/staff accounts?',
  keywords: ['employee management', 'staff management', 'add employee', 'manage users', 'add staff'],
  answer: `<p>This is done on the <strong>Users</strong> page (requires the "users_manage" permission):</p>
  <ul>
    <li><strong>Add Account</strong> — create a new user, set the username/password, and assign a role (Admin, Staff, Cashier, or a custom role if RBAC is unlocked)</li>
    <li><strong>Users Management Tab</strong> — view/edit existing accounts</li>
    <li><strong>Pending Requests Tab</strong> — for actions that need approval from a higher-access user (depending on permissions)</li>
    <li><strong>Roles &amp; Permissions Tab</strong> (RBAC premium) — to customize the access matrix per role</li>
    <li><strong>User Logs</strong> — shows a history of each user's actions (login/logout, sales, void, etc.)</li>
  </ul>
  <p>OmniPOS doesn't have a separate "HR" module (payroll, etc.) — its scope is access management only.</p>`
},
{
  id: 'shift-time-clock-attendance',
  category: 'Shift / Z-Reading',
  question: 'Does OmniPOS have time clock or attendance tracking?',
  keywords: ['time clock', 'attendance', 'time in time out', 'employee attendance'],
  verdict: 'hindi',
  answer: `<p>There's no dedicated "Time Clock / Attendance" feature yet (for HR purposes) in OmniPOS.</p>
  <p>The closest things to it:</p>
  <ul>
    <li><strong>Shift / Z-Reading</strong> — tracks when a cashier opens and closes a shift, along with cash reconciliation — this isn't for attendance/payroll, it's for cash accountability per shift</li>
    <li><strong>User Logs</strong> — records login/logout timestamps per user, which can be used as a rough reference for time in/out</li>
  </ul>`
},
{
  id: 'multibranch-management',
  category: 'Multi-Branch',
  question: 'How does Multi-Branch Management/Dashboard work?',
  keywords: ['multi branch', 'multiple branches', 'branch dashboard', 'business group code'],
  answer: `<p>The <strong>Multi-Branch Dashboard</strong> (premium module) shows a <strong>combined summary</strong> from every branch linked to the same business:</p>
  <ul>
    <li>First, set the same <strong>Business Group Code</strong> under Settings → Store &amp; Sales on every branch — this is what groups them together</li>
    <li>Each branch automatically sends a summary (today's gross sales, transaction count, low-stock count, active shifts) to the Relay server every few minutes — this requires an internet connection</li>
    <li>The <strong>Overview → "All Branches" widget</strong> shows the combined data from every branch, if you have the "branches_view" permission</li>
  </ul>
  <p>This is not real-time syncing of inventory/products between branches — it's summary/reporting only.</p>`
},

];
