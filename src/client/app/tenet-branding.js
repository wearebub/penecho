(function initTenetWhiteboardBranding(global) {
  "use strict";

  const config = global.PENECHO_CONFIG;
  if (!config || config.tenetMode !== true) return;

  const PRODUCT_NAME = "Tenet Whiteboard";
  const MANAGED_ATTR = "data-tenet-managed";
  const BRAND_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"];

  function replaceProductName(value) {
    if (!value || !value.includes("PenEcho")) return value;
    return value
      .replace(/PenEcho Agent/g, "Tenet Tutor")
      .replace(/PenEcho Cloud/g, "Tenet Cloud")
      .replace(/PenEcho/g, PRODUCT_NAME);
  }

  function upsertMeta(name, content) {
    let meta = document.head.querySelector(`meta[name="${name}"][${MANAGED_ATTR}]`);
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = name;
      meta.setAttribute(MANAGED_ATTR, "true");
      document.head.appendChild(meta);
    }
    meta.content = content;
  }

  function upsertLink(rel, href, sizes) {
    let link = document.head.querySelector(`link[rel="${rel}"][${MANAGED_ATTR}]`);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      link.setAttribute(MANAGED_ATTR, "true");
      document.head.appendChild(link);
    }
    link.href = href;
    if (sizes) link.sizes = sizes;
  }

  function installAppMetadata() {
    document.title = PRODUCT_NAME;
    document.documentElement.setAttribute("data-tenet-product", "whiteboard");
    upsertLink("stylesheet", "/tenet-branding.css");
    upsertLink("manifest", "/manifest.webmanifest");
    upsertLink("apple-touch-icon", "/tenet-whiteboard-icon-180.png", "180x180");
    upsertMeta("application-name", PRODUCT_NAME);
    upsertMeta("theme-color", "#14243b");
    upsertMeta("mobile-web-app-capable", "yes");
    upsertMeta("apple-mobile-web-app-capable", "yes");
    upsertMeta("apple-mobile-web-app-title", PRODUCT_NAME);
    upsertMeta("apple-mobile-web-app-status-bar-style", "default");
  }

  function shouldSkip(element) {
    return !element || Boolean(element.closest(
      ".tenet-product-lockup, script, style, noscript, template, code, pre"
    ));
  }

  function rewriteTextNode(node) {
    const parent = node.parentElement;
    if (shouldSkip(parent)) return;
    const next = replaceProductName(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function rewriteElement(element) {
    if (!element || shouldSkip(element)) return;
    let changed = false;
    for (const attribute of BRAND_ATTRIBUTES) {
      if (!element.hasAttribute(attribute)) continue;
      const current = element.getAttribute(attribute);
      const next = replaceProductName(current);
      if (next !== current) {
        element.setAttribute(attribute, next);
        changed = true;
      }
    }
    if (changed) {
      element.removeAttribute("data-i18n");
      element.removeAttribute("data-i18n-title");
      element.removeAttribute("data-i18n-placeholder");
      element.removeAttribute("data-i18n-aria-label");
    }
  }

  function rewriteSubtree(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      rewriteTextNode(root);
      return;
    }
    if (root.nodeType !== 1) return;
    rewriteElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      rewriteTextNode(textNode);
      textNode = walker.nextNode();
    }
    root.querySelectorAll(BRAND_ATTRIBUTES.map((name) => `[${name}]`).join(","))
      .forEach(rewriteElement);
  }

  function isStandalone() {
    return Boolean(
      global.navigator.standalone === true ||
      (global.matchMedia && global.matchMedia("(display-mode: standalone)").matches)
    );
  }

  function isIPad() {
    const platform = global.navigator.platform || "";
    const userAgent = global.navigator.userAgent || "";
    return /iPad/.test(userAgent) ||
      (platform === "MacIntel" && global.navigator.maxTouchPoints > 1);
  }

  function appendText(parent, tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function renderProductLockup() {
    let badge = document.getElementById("tenetBadge");
    if (!badge) {
      badge = document.createElement("aside");
      badge.id = "tenetBadge";
      document.body.appendChild(badge);
    }

    badge.hidden = false;
    badge.className = "tenet-badge tenet-product-lockup";
    badge.setAttribute("aria-label", `${PRODUCT_NAME}, student rules active`);
    badge.setAttribute(
      "title",
      "Google sign-in grants access to this private app. Tenet Gateway governs each AI turn."
    );
    badge.replaceChildren();

    const mark = document.createElement("img");
    mark.className = "tenet-brand-mark";
    mark.src = "/tenet-whiteboard-icon-180.png";
    mark.alt = "";
    mark.setAttribute("aria-hidden", "true");
    badge.appendChild(mark);

    const copy = document.createElement("div");
    copy.className = "tenet-brand-copy";
    appendText(copy, "span", "tenet-brand-eyebrow", "TENET AI GOVERNANCE");
    appendText(copy, "strong", "tenet-brand-name", PRODUCT_NAME);
    const session = appendText(copy, "span", "tenet-brand-session", "Student rules active");
    const dot = document.createElement("span");
    dot.className = "tenet-brand-session-dot";
    dot.setAttribute("aria-hidden", "true");
    session.prepend(dot);
    badge.appendChild(copy);

    if (isIPad() && !isStandalone()) {
      appendText(
        badge,
        "span",
        "tenet-install-hint",
        "On iPad: Share, then Add to Home Screen"
      );
    }

    appendText(
      badge,
      "span",
      "tenet-brand-source",
      "Canvas foundation: PenEcho | AGPL-3.0"
    );
  }

  function startBrandEnforcement() {
    if (!global.MutationObserver || !document.body) return;
    if (global.__tenetWhiteboardBrandObserver) {
      global.__tenetWhiteboardBrandObserver.disconnect();
    }
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") {
          rewriteTextNode(record.target);
          continue;
        }
        if (record.type === "attributes") {
          rewriteElement(record.target);
          continue;
        }
        record.addedNodes.forEach(rewriteSubtree);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: BRAND_ATTRIBUTES,
    });
    global.__tenetWhiteboardBrandObserver = observer;
    global.addEventListener("pagehide", () => observer.disconnect(), { once: true });
  }

  function applyBranding() {
    document.body.classList.add("tenet-mode", "tenet-whiteboard");
    rewriteSubtree(document.body);
    renderProductLockup();
    startBrandEnforcement();
  }

  installAppMetadata();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyBranding, { once: true });
  } else {
    applyBranding();
  }
})(window);
