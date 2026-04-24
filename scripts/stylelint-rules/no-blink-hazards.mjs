/**
 * Stylelint plugin: no-blink-hazards
 *
 * En samling stylelint-regler som fanger CSS-mønstre som har forårsaket
 * visuelle regresjoner (blink/flimmer) i Game 1, der HTML-overlays ligger
 * over en kontinuerlig-rendrende Pixi-canvas.
 *
 * Se `docs/engineering/CSS_LINTING.md` for begrunnelse, og
 * `packages/game-client/src/games/game1/ARCHITECTURE.md` for den konkrete
 * blink-historikken (PR #468, 2026-04-24).
 *
 * Regler eksportert:
 *   - plugin/no-backdrop-filter-without-allowlist
 *   - plugin/no-transition-all
 *   - plugin/animation-iteration-whitelist
 *   - plugin/will-change-whitelist
 *
 * Alle regler bruker stylelint 17s ESM createPlugin-API.
 */

import stylelint from "stylelint";

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normaliser en selector-streng til en forenklet form for allowlist-matching.
 * Fjerner whitespace rundt kombinatorer slik at ".g1-overlay-root > div" og
 * ".g1-overlay-root>div" matcher samme allowlist-oppføring. Lowercase.
 */
function normalizeSelector(selector) {
  return selector
    .toLowerCase()
    .replace(/\s*>\s*/g, " > ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returner alle selectors i en postcss Rule-node som en flat liste av
 * normaliserte strenger. Håndterer multi-selectors ("a, b, c").
 */
function getRuleSelectors(rule) {
  if (!rule || typeof rule.selector !== "string") return [];
  return rule.selector
    .split(",")
    .map((s) => normalizeSelector(s))
    .filter(Boolean);
}

/**
 * Sjekker om en selector matcher en allowlist. Allowlist-oppføringer kan
 * være enten eksakte strenger eller end-matching (så ".popup-backdrop"
 * matcher både ".popup-backdrop" og ".modal .popup-backdrop").
 */
function matchesAllowedSelector(selector, allowed) {
  const norm = normalizeSelector(selector);
  for (const a of allowed) {
    const aNorm = normalizeSelector(a);
    if (norm === aNorm) return true;
    // Allow selectors that END with the allowlist entry, preceded by whitespace
    // or a combinator. Prevents ".foo-popup-backdrop" from matching
    // ".popup-backdrop" but allows ".modal .popup-backdrop".
    if (norm.endsWith(" " + aNorm) || norm.endsWith(">" + aNorm)) return true;
  }
  return false;
}

/**
 * Trekk ut animation-name fra en full `animation`-shorthand eller fra
 * `animation-name`-longhand. Returnerer null hvis vi ikke klarer å finne
 * et navn.
 *
 * Shorthand-syntaks er kompleks; vi tar en pragmatisk tilnærming: del på
 * whitespace, og plukk den første tokenet som ikke er en kjent
 * reserved/keyword/enhet/tid.
 */
const ANIMATION_RESERVED = new Set([
  "none", "initial", "inherit", "unset", "revert", "revert-layer",
  "infinite", "normal", "reverse", "alternate", "alternate-reverse",
  "forwards", "backwards", "both", "running", "paused",
  "ease", "ease-in", "ease-out", "ease-in-out", "linear", "step-start", "step-end",
]);

function isTime(token) {
  return /^-?\d*\.?\d+(s|ms)$/i.test(token);
}

function isNumber(token) {
  return /^-?\d*\.?\d+$/.test(token);
}

function isCubicBezierOrSteps(token) {
  return /^(cubic-bezier|steps)\(/i.test(token);
}

function extractAnimationName(shorthandValue) {
  if (!shorthandValue) return null;
  // Split on whitespace but not inside parentheses
  const tokens = [];
  let depth = 0;
  let current = "";
  for (const ch of shorthandValue) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  for (const t of tokens) {
    const low = t.toLowerCase();
    if (ANIMATION_RESERVED.has(low)) continue;
    if (isTime(t)) continue;
    if (isNumber(t)) continue;
    if (isCubicBezierOrSteps(t)) continue;
    return t;
  }
  return null;
}

/**
 * Sjekker om `animation` shorthand eller `animation-iteration-count` har
 * `infinite`-keyword. Case-insensitive.
 */
function hasInfiniteIteration(value) {
  return /\binfinite\b/i.test(value);
}

// ---------------------------------------------------------------------------
// Rule 1: no-backdrop-filter-without-allowlist
// ---------------------------------------------------------------------------

const R1_NAME = "plugin/no-backdrop-filter-without-allowlist";
const r1Messages = ruleMessages(R1_NAME, {
  rejected: (selector) =>
    `backdrop-filter på "${selector}" er ikke i allowlist. ` +
    `HTML-overlays over Pixi-canvas skal ikke bruke backdrop-filter fordi ` +
    `det tvinger GPU til å re-kjøre blur-shader per Pixi-frame (flimmer). ` +
    `Fix: bruk solid semi-transparent bakgrunn (alpha >= 0.85) i stedet. ` +
    `Se packages/game-client/src/games/game1/ARCHITECTURE.md.`,
});

const r1Meta = { url: "docs/engineering/CSS_LINTING.md#no-backdrop-filter" };

const r1Rule = (primary, secondaryOptions) => (root, result) => {
  const validOptions = validateOptions(
    result,
    R1_NAME,
    { actual: primary, possible: [true, false] },
    {
      actual: secondaryOptions,
      possible: { allowedSelectors: [(v) => typeof v === "string"] },
      optional: true,
    },
  );
  if (!validOptions || primary !== true) return;

  const allowed = (secondaryOptions && secondaryOptions.allowedSelectors) || [];

  root.walkDecls(/^(-webkit-)?backdrop-filter$/i, (decl) => {
    const v = (decl.value || "").trim().toLowerCase();
    if (!v || v === "none" || v === "initial" || v === "unset" ||
        v === "inherit" || v === "revert" || v === "revert-layer") {
      return;
    }

    const parentRule = decl.parent;
    // Skip at-rule direct ancestry (no selector, like @font-face)
    if (!parentRule || parentRule.type !== "rule") return;

    const selectors = getRuleSelectors(parentRule);
    const anyAllowed = selectors.some((s) => matchesAllowedSelector(s, allowed));
    if (anyAllowed) return;

    for (const s of selectors) {
      report({
        result,
        ruleName: R1_NAME,
        message: r1Messages.rejected,
        messageArgs: [s],
        node: decl,
        word: "backdrop-filter",
      });
      // One report per selector-group is enough; break after first to avoid
      // duplicate noise if a multi-selector rule has only one bad part.
      break;
    }
  });
};

r1Rule.ruleName = R1_NAME;
r1Rule.messages = r1Messages;
r1Rule.meta = r1Meta;

// ---------------------------------------------------------------------------
// Rule 2: no-transition-all
// ---------------------------------------------------------------------------

const R2_NAME = "plugin/no-transition-all";
const r2Messages = ruleMessages(R2_NAME, {
  rejected: (property) =>
    `${property}: all forårsaker utilsiktede transitions på alle endrede ` +
    `properties (inkl. layout/paint som skaper flimmer). ` +
    `Fix: spesifiser eksakte properties (f.eks. "transition: opacity 0.3s, transform 0.3s").`,
});

const r2Meta = { url: "docs/engineering/CSS_LINTING.md#no-transition-all" };

const r2Rule = (primary) => (root, result) => {
  const validOptions = validateOptions(result, R2_NAME, {
    actual: primary, possible: [true, false],
  });
  if (!validOptions || primary !== true) return;

  root.walkDecls(/^transition(-property)?$/i, (decl) => {
    const prop = decl.prop.toLowerCase();
    const value = (decl.value || "").trim();

    if (prop === "transition-property") {
      // transition-property may have multiple comma-separated values
      const hasAll = value
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .some((p) => p === "all");
      if (hasAll) {
        report({
          result, ruleName: R2_NAME,
          message: r2Messages.rejected, messageArgs: [prop],
          node: decl, word: "all",
        });
      }
      return;
    }

    // transition shorthand: look for " all " or "all " at start, stand-alone token
    // per comma-separated transition-list item.
    const items = value.split(",").map((s) => s.trim());
    for (const item of items) {
      const tokens = item.split(/\s+/).map((t) => t.toLowerCase());
      if (tokens.includes("all")) {
        report({
          result, ruleName: R2_NAME,
          message: r2Messages.rejected, messageArgs: [prop],
          node: decl, word: "all",
        });
        break;
      }
    }
  });
};

r2Rule.ruleName = R2_NAME;
r2Rule.messages = r2Messages;
r2Rule.meta = r2Meta;

// ---------------------------------------------------------------------------
// Rule 3: animation-iteration-whitelist
// ---------------------------------------------------------------------------

const R3_NAME = "plugin/animation-iteration-whitelist";
const r3Messages = ruleMessages(R3_NAME, {
  rejected: (name) =>
    `animation "${name}" kjører infinite men er ikke i allowlist. ` +
    `Infinite-animasjoner over Pixi-canvas koster GPU-ressurser hver frame ` +
    `og kan gi flimmer. Legg til navnet i ` +
    `.stylelintrc.json > plugin/animation-iteration-whitelist > allowedNames, ` +
    `eller sett animation-iteration-count til et begrenset tall.`,
  rejectedAnonymous: () =>
    `animation-iteration-count: infinite krever navngitt animation i allowlist. ` +
    `Flytt animation-name til samme rule, eller bruk begrenset iteration-count.`,
});

const r3Meta = { url: "docs/engineering/CSS_LINTING.md#animation-iteration-whitelist" };

const r3Rule = (primary, secondaryOptions) => (root, result) => {
  const validOptions = validateOptions(
    result, R3_NAME,
    { actual: primary, possible: [true, false] },
    {
      actual: secondaryOptions,
      possible: { allowedNames: [(v) => typeof v === "string"] },
      optional: true,
    },
  );
  if (!validOptions || primary !== true) return;

  const allowed = new Set(
    ((secondaryOptions && secondaryOptions.allowedNames) || []).map((n) =>
      String(n).toLowerCase(),
    ),
  );

  /**
   * Samle (name?, hasInfinite) pr parent rule så vi kan vurdere begge
   * short- og longhand i samme rule.
   */
  root.walkRules((rule) => {
    let hasInfinite = false;
    let animationName = null;
    let offendingDecl = null;

    rule.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      const value = (decl.value || "").trim();

      if (prop === "animation") {
        if (hasInfiniteIteration(value)) {
          hasInfinite = true;
          offendingDecl = decl;
          const name = extractAnimationName(value);
          if (name) animationName = name;
        } else {
          // Non-infinite animation shorthand may still set the name we need
          // to know about elsewhere; update name regardless.
          const name = extractAnimationName(value);
          if (name && !animationName) animationName = name;
        }
      } else if (prop === "animation-name") {
        if (!animationName) animationName = value;
      } else if (prop === "animation-iteration-count") {
        if (hasInfiniteIteration(value)) {
          hasInfinite = true;
          offendingDecl = decl;
        }
      }
    });

    if (!hasInfinite) return;

    if (!animationName) {
      report({
        result, ruleName: R3_NAME,
        message: r3Messages.rejectedAnonymous,
        node: offendingDecl || rule,
      });
      return;
    }

    if (allowed.has(animationName.toLowerCase())) return;

    report({
      result, ruleName: R3_NAME,
      message: r3Messages.rejected,
      messageArgs: [animationName],
      node: offendingDecl || rule,
    });
  });
};

r3Rule.ruleName = R3_NAME;
r3Rule.messages = r3Messages;
r3Rule.meta = r3Meta;

// ---------------------------------------------------------------------------
// Rule 4: will-change-whitelist
// ---------------------------------------------------------------------------

const R4_NAME = "plugin/will-change-whitelist";
const r4Messages = ruleMessages(R4_NAME, {
  rejected: (prop) =>
    `will-change: ${prop} — bare egenskaper som kan komposites GPU-billig ` +
    `skal hinte browser til egne lag. Fix: begrens til transform/opacity, ` +
    `eller legg til property i allowlist hvis nødvendig.`,
});

const r4Meta = { url: "docs/engineering/CSS_LINTING.md#will-change-whitelist" };

const r4Rule = (primary, secondaryOptions) => (root, result) => {
  const validOptions = validateOptions(
    result, R4_NAME,
    { actual: primary, possible: [true, false] },
    {
      actual: secondaryOptions,
      possible: { allowedProperties: [(v) => typeof v === "string"] },
      optional: true,
    },
  );
  if (!validOptions || primary !== true) return;

  const allowed = new Set(
    ((secondaryOptions && secondaryOptions.allowedProperties) || []).map((p) =>
      String(p).toLowerCase(),
    ),
  );
  // Reserved will-change values that aren't actual CSS properties
  const reserved = new Set(["auto", "initial", "inherit", "unset", "revert", "revert-layer"]);

  root.walkDecls(/^will-change$/i, (decl) => {
    const props = (decl.value || "")
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    for (const p of props) {
      if (reserved.has(p)) continue;
      if (allowed.has(p)) continue;
      report({
        result, ruleName: R4_NAME,
        message: r4Messages.rejected, messageArgs: [p],
        node: decl, word: p,
      });
    }
  });
};

r4Rule.ruleName = R4_NAME;
r4Rule.messages = r4Messages;
r4Rule.meta = r4Meta;

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

// Stylelint 17 createPlugin returns a single plugin, but a plugin module can
// default-export an array to register multiple rules at once.
const plugins = [
  createPlugin(R1_NAME, r1Rule),
  createPlugin(R2_NAME, r2Rule),
  createPlugin(R3_NAME, r3Rule),
  createPlugin(R4_NAME, r4Rule),
];

export default plugins;
