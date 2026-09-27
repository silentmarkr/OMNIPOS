// uom-pricing.js
// -----------------------------------------------------------------------------
// Server-side pricing/stock math for: selling by weight (decimal quantities),
// units of measure (UOM) with a conversion factor to the product's base unit,
// and price levels (e.g. Retail/Wholesale) set in Store Settings.
//
// Design decisions this module implements (as agreed):
//  - Stock is always stored in the product's BASE unit. Every sale line has a
//    selling-unit `quantity` and a `baseQty` (quantity * factor) — baseQty is
//    what gets deducted from stock.
//  - A product only accepts fractional quantities if `product.allowDecimal`
//    is true, and only up to 3 decimal places.
//  - `product.uom` is an optional array of { name, factor, fixedPrice? }.
//    factor converts 1 of that unit into base units (e.g. Dozen -> 12).
//    fixedPrice, if set, REPLACES basePrice*factor for that unit entirely
//    (e.g. a Box priced at a rounded ₱480 instead of 24 * unit price).
//  - `product.priceLevels` is an optional { levelName: price } map of
//    base-unit-price overrides. A cashier needs the `price_level_select`
//    permission to use any level other than the default/base price — this
//    module takes that permission check as a boolean input; it does not know
//    about roles/permissions itself.
//  - The server computes and verifies price/stock — nothing here trusts a
//    price sent by the client.
//  - One unit of measure per product PER SALE: the same product code cannot
//    appear twice in one cart with two different units (e.g. one line of
//    1 Box and another of 3 pcs of the same product). validateCartUnits()
//    enforces this.
// -----------------------------------------------------------------------------

const DECIMAL_PLACES = 3;
const DECIMAL_EPSILON = 1e-6;

function round(n, places) {
    const f = Math.pow(10, places);
    return Math.round((n + Number.EPSILON) * f) / f;
}

function round2(n) {
    return round(n, 2);
}

function isPositiveNumber(n) {
    return typeof n === 'number' && isFinite(n) && n > 0;
}

// Returns true if `qty` has no more than DECIMAL_PLACES fractional digits
// (protects against float noise like 0.1 + 0.2).
function hasValidPrecision(qty) {
    const scaled = qty * Math.pow(10, DECIMAL_PLACES);
    return Math.abs(scaled - Math.round(scaled)) < DECIMAL_EPSILON;
}

// Finds the UOM entry matching unitName on a product. Returns:
//   { isBase: true, factor: 1, fixedPrice: null }                    for base unit (unitName empty/null/'base')
//   { isBase: false, factor, fixedPrice, name }                       for a matching product.uom[] entry
//   null                                                              if unitName was given but doesn't match anything
function resolveUnit(product, unitName) {
    const requested = (unitName === undefined || unitName === null) ? '' : String(unitName).trim();
    if (!requested || requested.toLowerCase() === 'base') {
        return { isBase: true, factor: 1, fixedPrice: null, name: product && product.baseUnit ? product.baseUnit : 'unit' };
    }
    const list = Array.isArray(product && product.uom) ? product.uom : [];
    const entry = list.find(u => u && String(u.name || '').trim().toLowerCase() === requested.toLowerCase());
    if (!entry || !isPositiveNumber(parseFloat(entry.factor))) return null;
    const fixedPrice = isPositiveNumber(parseFloat(entry.fixedPrice)) ? round2(parseFloat(entry.fixedPrice)) : null;
    return { isBase: false, factor: parseFloat(entry.factor), fixedPrice, name: entry.name };
}

// Picks the base-unit price to use before any UOM factor/fixedPrice is applied:
// the product's own `price`, or a Store-Settings price level override.
//   canUsePriceLevel: boolean — the caller (route) must have already checked the
//   cashier's `price_level_select` permission when priceLevel is anything other
//   than empty (no level / catalog price).
// NOTE: only a blank/empty level means "no level". A level is NOT treated as
// "no level" just because the store happened to name it "Retail" or "Default" —
// doing that used to silently discard the price the owner set for a Price Level
// with that exact name (e.g. a store that configured "Wholesale" and "Retail" as
// its two named Price Levels would have "Retail" sales quietly re-priced at the
// bare catalog price at checkout, even though the client correctly showed and
// added the item at the Retail level's own price). The client only ever sends ''
// or null for "no level", never the words "default"/"retail" as a stand-in, so
// this special case had no legitimate use and only caused that collision.
function resolveBasePrice(product, priceLevel, canUsePriceLevel) {
    const level = (priceLevel === undefined || priceLevel === null) ? '' : String(priceLevel).trim();
    const catalogPrice = round2(parseFloat(product && product.price) || 0);
    if (!level) {
        return { ok: true, basePrice: catalogPrice, levelUsed: null };
    }
    if (!canUsePriceLevel) {
        return { ok: false, error: `Not authorized to use the "${level}" price level.` };
    }
    const levels = (product && typeof product.priceLevels === 'object' && product.priceLevels) || {};
    const override = levels[level];
    if (!isPositiveNumber(parseFloat(override))) {
        // Level exists in Store Settings but this product has no override — fall back to catalog price.
        return { ok: true, basePrice: catalogPrice, levelUsed: null };
    }
    return { ok: true, basePrice: round2(parseFloat(override)), levelUsed: level };
}

// Resolves one cart line into verified pricing + stock-impact figures.
// item: { code, quantity, unit, priceLevel, itemDiscount }
// Returns { ok:true, code, name, unitName, factor, quantity, baseQty, unitPrice, lineSubtotal, itemDiscount, cost }
// or { ok:false, error }.
function resolveLine(product, item, opts = {}) {
    if (!product) return { ok: false, error: 'Product not found.' };
    const unit = resolveUnit(product, item.unit);
    if (!unit) return { ok: false, error: `${product.name}: unknown unit "${item.unit}".` };

    // Number() (not parseFloat) so junk like "3abc" is rejected instead of silently read as 3.
    const qtyText = (item.quantity === undefined || item.quantity === null) ? '' : String(item.quantity).trim();
    const rawQty = qtyText === '' ? NaN : Number(qtyText);
    if (!isFinite(rawQty) || rawQty <= 0) {
        return { ok: false, error: `${product.name}: invalid quantity (${item.quantity}).` };
    }
    const allowDecimal = !!(product && product.allowDecimal);
    const isWhole = Math.abs(rawQty - Math.round(rawQty)) < DECIMAL_EPSILON;
    if (!isWhole && !allowDecimal) {
        return { ok: false, error: `${product.name} is not sold by decimal quantity — whole numbers only.` };
    }
    if (!isWhole && !hasValidPrecision(rawQty)) {
        return { ok: false, error: `${product.name}: quantity can have at most ${DECIMAL_PLACES} decimal places.` };
    }
    const quantity = isWhole ? Math.round(rawQty) : round(rawQty, DECIMAL_PLACES);
    // e.g. 0.0000001 passes the "is whole" epsilon test and rounds to 0 — that would be a free, zero-quantity line.
    if (!(quantity > 0)) {
        return { ok: false, error: `${product.name}: invalid quantity (${item.quantity}).` };
    }
    const baseQty = round(quantity * unit.factor, DECIMAL_PLACES);
    if (!(baseQty > 0)) {
        return { ok: false, error: `${product.name}: invalid quantity (${item.quantity}).` };
    }

    const priceResult = resolveBasePrice(product, item.priceLevel, !!opts.canUsePriceLevel);
    if (!priceResult.ok) return { ok: false, error: `${product.name}: ${priceResult.error}` };

    // A fixedPrice on the UOM entry replaces basePrice*factor for that unit
    // (e.g. a Box sold at a rounded price instead of 24 * per-piece price) —
    // but it's a rounded convenience price calibrated against the product's
    // plain catalog price only, never against a Price Level's own price. So
    // once a Price Level override is actually in effect (priceResult.levelUsed
    // set), the level's price must still take effect: the fixedPrice is
    // ignored and the line is priced as basePrice(level) * factor instead.
    // Without this, a product with a fixed unit price would keep charging that
    // same flat amount no matter which Price Level (e.g. Wholesale) was
    // selected, silently discarding the level's price.
    const useFixedPrice = unit.fixedPrice !== null && !priceResult.levelUsed;
    const unitPrice = useFixedPrice ? unit.fixedPrice : round2(priceResult.basePrice * unit.factor);
    const lineSubtotal = round2(unitPrice * quantity);
    const itemDiscount = Math.min(Math.max(0, parseFloat(item.itemDiscount) || 0), lineSubtotal);

    return {
        ok: true,
        code: product.code,
        name: product.name,
        unitName: unit.isBase ? null : unit.name,
        // The product's base unit label (e.g. "kilo", "pcs") — carried onto the receipt so a
        // sale made in a bigger selling unit (e.g. "Sako") can also show its base-unit
        // quantity and per-base-unit price, so the buyer can double-check the math.
        baseUnit: product && product.baseUnit ? String(product.baseUnit).trim() : '',
        factor: unit.factor,
        priceLevel: priceResult.levelUsed,
        quantity,
        baseQty,
        unitPrice,
        lineSubtotal,
        itemDiscount,
        // product.cost is per BASE unit. Existing reports compute cost * line quantity (selling units),
        // so return the cost of ONE SELLING UNIT (e.g. a Sack = 25 x the per-kg cost).
        cost: round((parseFloat(product.cost) || 0) * unit.factor, 4)
    };
}

// Enforces "one UOM per product per sale": rejects a cart where the same product
// code appears in more than one line with a different resolved unit.
function validateCartUnits(items) {
    const seen = new Map(); // code -> unitName (null = base)
    for (const item of items) {
        const code = (item.code !== undefined && item.code !== null && String(item.code) !== '') ? item.code : `name:${item.name}`;
        const rawUnit = (item.unit === undefined || item.unit === null) ? '' : String(item.unit).trim().toLowerCase();
        const unitKey = (rawUnit === '' || rawUnit === 'base') ? null : rawUnit;
        if (seen.has(code) && seen.get(code) !== unitKey) {
            return { ok: false, error: `This sale has two different units of measure for the same product (code ${code}) — combine it into a single line.` };
        }
        seen.set(code, unitKey);
    }
    return { ok: true };
}

// Same normalization resolveBasePrice() uses for a requested level: only a blank
// value means "no level / Retail". A level actually named "Retail" or "Default"
// by the store is a real, distinct level and must NOT be folded back into ''
// here, or a sale under that named level would look "mixed" against a sale with
// no level at all and get wrongly rejected/merged by validateCartPriceLevel().
function normalizePriceLevelKey(raw) {
    const level = (raw === undefined || raw === null) ? '' : String(raw).trim();
    if (!level) return '';
    return level;
}

// Enforces "one Price Level per sale": every line in the cart must request the SAME
// Price Level (Retail/'' counts as a level too). This mirrors the POS UI's own cart-wide
// price-level lock (checkCartPriceLevelGuard() in app.js — once the cart has an item, its
// price level is locked and a conflicting scan/selection is rejected), but that check only
// runs in the browser. This is the server-side backstop: it's what actually stops a sale
// from being recorded with two different price levels — whether from a bug in the client,
// a direct/modified API call, or a stale cached cart — for example the SAME product code
// showing up twice at two different prices because one line kept its Retail price while
// another line was quietly switched to Wholesale. Called once per transaction, before any
// line is priced, so a mixed-level sale is rejected outright instead of silently billing
// part of the cart at an unexpected price.
function validateCartPriceLevel(items) {
    let lockedLevel = null;
    let lockedLabel = '';
    for (const item of (items || [])) {
        const key = normalizePriceLevelKey(item && item.priceLevel);
        if (lockedLevel === null) {
            lockedLevel = key;
            lockedLabel = key || 'Retail';
            continue;
        }
        if (key !== lockedLevel) {
            return {
                ok: false,
                error: `Hindi puwedeng maghalo ng price level sa isang benta (${lockedLabel} at ${key || 'Retail'}) — tapusin o i-clear muna ang kasalukuyang benta bago lumipat ng price level.`
            };
        }
    }
    return { ok: true };
}

module.exports = {
    DECIMAL_PLACES,
    round,
    round2,
    hasValidPrecision,
    resolveUnit,
    resolveBasePrice,
    resolveLine,
    validateCartUnits,
    normalizePriceLevelKey,
    validateCartPriceLevel
};
