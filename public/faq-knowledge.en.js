

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
  keywords: ['loyalty points', 'customer points', 'rewards', 'redeem points', 'select customer'],
  answer: `<p>In the POS Terminal, there's a "Select Customer" option to attach a registered customer to the transaction. Once checked out:</p>
  <ul>
    <li>The customer earns <strong>1 point for every ₱100</strong> spent.</li>
    <li>If the customer is redeeming points, those are deducted first before the newly earned points are added.</li>
    <li>The customer's record (total amount spent and visit count) is automatically updated.</li>
    <li>The points earned and the new balance appear right on the receipt.</li>
  </ul>`
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
  id: 'receipt-taiwan-template',
  category: 'Receipt Settings',
  question: 'Is there a narrow receipt format option for other types of printers?',
  keywords: ['taiwan template', 'makitid na resibo', 'narrow receipt', 'compact receipt format'],
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
  answer: `<p>Besides Pro Themes, OmniPOS also has full modules locked as premium features until unlocked: Purchase Orders Module, Customer Profiles & Loyalty, Promo Codes Module, Sales Analytics & Advanced Reports, Multi-Cashier Shift Oversight & Z-Reading, Roles & Permissions (RBAC) Management, and Multi-Branch Dashboard.</p>
  <p>When you try to use a locked feature, its details (name, price, short explanation) appear along with the option to request an unlock.</p>`
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
    <li><strong>Pro Upgrade (Complete)</strong> — EVERY module, EVERY Pro Theme, AND Cloud Backup — nothing left locked.</li>
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
  answer: `<p>Cloud Backup is a separate premium feature (a one-time purchase) that syncs the entire database — all modules, including user accounts (but NOT passwords) — to secure online storage, to protect your data in case the device is damaged or lost. Once unlocked, there's a button to back up manually and to restore from the latest cloud backup.</p>`
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
    <li>A <strong>COMPLETE backup</strong> of all data is collected (users, products, transactions, logs, requests, categories, customers, shifts, etc.).</li>
    <li>This backup is sent to your email first — <strong>if the email fails</strong> (e.g. wrong app password), <strong>the entire reset is stopped</strong> and your data remains SAFE.</li>
    <li>Once the email succeeds, only then does the erasing happen: users revert to the default set of accounts, products/transactions/requests/customers/shifts/logs are deleted, and categories revert to the default set.</li>
  </ol>
  <p><strong>Deliberately left untouched:</strong> the count of FREE receipt customizations — so Factory Reset can't be used just to get the 2 free attempts back.</p>`
},
{
  id: 'system-restore-backup',
  category: 'System Reset',
  question: 'How do I restore from a backup file?',
  keywords: ['restore backup', 'ibalik ang backup', 'import backup file', 'recover data'],
  answer: `<p>In the Restore Backup feature, you need the Admin username, password, and the backup file (from a previous Factory Reset email or a manual export). Once the admin credentials are verified, all data (users, products, transactions, user logs, requests, categories, carts) is synced from the contents of that backup file.</p>`
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
    <li>Additional Receipt Customization options — logo header, double-copy printing, loyalty QR position, and a narrow (Taiwan) format.</li>
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

];
