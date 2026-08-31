"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("toolbar ships a left-navigation Favorites workbench with list and grid views", () => {
  const page = read("public/index.html"), app = read("src/client/app/core.js"), script = read("public/cloud-connect.js"), locale = read("public/locales/zh.js"), css = read("public/style.css");

  assert.match(page, /id="craftsButton"[^>]*aria-controls="craftsPopover"/);
  assert.match(page, /id="craftsButton"[^>]*data-i18n-aria="savedCrafts"/);
  assert.match(page, /id="craftsPopover"[^>]*hidden/);
  assert.match(page, /class="plugin-modal crafts-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="craftsTitle"[^>]*aria-describedby="craftsSubtitle"[^>]*tabindex="-1"/);
  assert.match(page, /<aside class="crafts-sidebar">[\s\S]*?<section class="crafts-workspace">/);
  assert.match(page, /id="craftsSubtitle"[^>]*data-i18n="savedCraftsSubtitle"/);
  assert.match(page, /id="craftsRefreshStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
  assert.match(page, /id="craftsFilterAll" class="crafts-nav-item active"[^>]*role="tab"[^>]*aria-selected="true"[\s\S]*?data-crafts-filter-label data-i18n="all"/);
  assert.match(page, /id="craftsFilterWidgets" class="crafts-nav-item"[^>]*role="tab"[\s\S]*?data-crafts-filter-label data-i18n="widgets"/);
  assert.match(page, /id="craftsFilterCanvases" class="crafts-nav-item"[^>]*role="tab"[\s\S]*?data-crafts-filter-label data-i18n="canvases"/);
  assert.match(page, /id="craftsViewSwitch"[^>]*role="group"[^>]*data-i18n-aria="savedView"/);
  assert.match(page, /id="craftsViewList"[^>]*aria-pressed="true"[^>]*data-i18n-aria="savedListView"/);
  assert.match(page, /id="craftsViewGrid"[^>]*aria-pressed="false"[^>]*data-i18n-aria="savedGridView"/);
  assert.match(page, /id="craftsEchoesLink"[^>]*target="_blank"[^>]*rel="noopener"/);
  assert.match(page, /id="craftsCount"[^>]*aria-live="polite"/);
  assert.match(page, /id="craftsClose"[^>]*data-i18n-aria="closeSavedCrafts"[^>]*data-i18n-title="closeSavedCrafts"[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(page, /class="crafts-empty"[^>]*data-i18n="savedLoading"/);

  assert.match(script, /const FAVORITE_PAGE_SIZE = 20/);
  assert.match(script, /\/api\/cloud\/favorites\/feed\?/);
  assert.match(script, /function toggleWidgetFavorite/);
  assert.match(script, /function syncLocalFavorites/);
  assert.match(script, /scheduleLocalFavoriteSync/);
  assert.match(script, /function activateFavoriteCraft/);
  assert.match(script, /merged\.kind !== "canvas"/);
  assert.match(script, /return takeFurther\(community\.id\)/);
  assert.match(script, /let selectedCraftKind = "all"/);
  assert.match(script, /let selectedCraftView = "list"/);
  assert.match(script, /function filteredFavoriteCrafts/);
  assert.match(script, /function updateCraftView/);
  assert.match(script, /function updateCraftsEchoesLink/);
  assert.match(script, /function favoriteCraftTime/);
  assert.match(script, /favoriteCraftTime\(b\) - favoriteCraftTime\(a\)/);
  assert.match(script, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);
  assert.match(script, /let craftsRestoreFocus = null/);
  assert.match(script, /const focusable = focusableElements\(dialog\)/);
  assert.match(script, /restore\?\.focus\?\.\(\)/);
  assert.match(script, /craftsList\?\.setAttribute\("aria-busy", String\(refreshing\)\)/);
  assert.match(script, /data-crafts-filter-label/);
  assert.match(script, /row\.append\(media, copy, actions\)/);
  assert.match(script, /craftsCount\.textContent = savedT\("savedCount"/);

  assert.match(locale, /savedCrafts: "收藏"/);
  assert.match(locale, /savedCraftsTitle: "收藏"/);
  assert.match(locale, /savedCraftsSubtitle: "画布与组件"/);
  assert.match(locale, /savedGridView: "网格视图"/);
  assert.match(locale, /browseEchoes: "浏览 Echoes"/);
  assert.match(locale, /savedCount: "\{count\} 个收藏"/);
  assert.match(locale, /savedSourceSynced: "云端 \+ 本机"/);
  assert.match(locale, /savedLoading: "正在加载收藏…"/);
  assert.match(locale, /savedRefreshing: "正在刷新…"/);

  const craftsCss = css.slice(css.indexOf("/* Favorite Crafts picker"), css.indexOf("/* Harness-backed PenEcho Agent"));
  assert.notEqual(craftsCss, "");
  assert.doesNotMatch(craftsCss, /Favorites keeps its original title \+ tabs \+ list structure/);
  const modalRule = craftsCss.match(/\.crafts-modal\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(modalRule, /width:\s*min\(960px,\s*100%\)/);
  assert.match(modalRule, /height:\s*min\(680px,\s*calc\(100dvh - 48px\)\)/);
  assert.match(modalRule, /grid-template-columns:\s*228px minmax\(0,\s*1fr\)/);
  assert.match(modalRule, /background:\s*color-mix\(in srgb,\s*var\(--panel-raised\)\s*92%,\s*transparent\)/);
  assert.match(modalRule, /box-shadow:\s*0 6px 14px/);
  assert.match(craftsCss, /\.crafts-sidebar\s*\{[^}]*border-right:\s*1px solid/);
  assert.match(craftsCss, /\.crafts-workspace\s*\{[^}]*grid-template-rows:\s*50px minmax\(0,\s*1fr\)/);
  assert.match(craftsCss, /\.crafts-nav-item\s*\{[^}]*min-height:\s*34px/);
  assert.match(craftsCss, /\.crafts-nav-item:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gold-bright\)/);
  assert.match(craftsCss, /\.crafts-view-switch\s*\{[^}]*height:\s*32px/);
  assert.match(craftsCss, /\.crafts-view-option\s*\{[^}]*width:\s*27px[^}]*height:\s*26px/);
  assert.match(craftsCss, /\.crafts-view-option\.active\s*\{[^}]*color:\s*var\(--gold-bright\)/);
  assert.match(craftsCss, /\.crafts-modal \.cloud-dialog-close\s*\{[^}]*width:\s*32px[^}]*height:\s*32px/);
  assert.match(craftsCss, /\.crafts-row\s*\{[^}]*grid-template-columns:\s*88px minmax\(0,\s*1fr\) auto[^}]*min-height:\s*78px/);
  assert.match(craftsCss, /\.crafts-add, \.crafts-open\s*\{[^}]*height:\s*30px[^}]*font-weight:\s*500/);
  assert.match(craftsCss, /\.crafts-remove::before\s*\{[^}]*mask:/s);
  assert.match(craftsCss, /\.crafts-list\.is-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(216px,\s*1fr\)\)[^}]*grid-auto-rows:\s*max-content/);
  assert.match(craftsCss, /\.crafts-list\.is-grid \.crafts-row\s*\{[^}]*grid-template-areas:\s*"preview" "title" "description" "footer"/);
  assert.match(craftsCss, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.crafts-sidebar\s*\{[^}]*grid-template-areas:\s*"brand echoes" "filters filters"/);
  assert.match(craftsCss, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.crafts-row\s*\{[^}]*grid-template-columns:\s*72px minmax\(0,\s*1fr\)/);
  assert.match(craftsCss, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.crafts-refresh-spinner\s*\{[^}]*animation:\s*none/);

  const bilingualKeys = [
    "savedCrafts", "savedCraftsTitle", "savedCraftsSubtitle", "savedType", "savedView", "savedListView", "savedGridView", "browseEchoes", "savedCount", "savedLoading", "savedRefreshing", "savedEmptyIn", "savedEmptyOut",
    "savedAdd", "savedAdding", "savedOpen", "savedOpening", "savedCanvas", "savedWidget", "savedRemoveTitle", "savedSourceLocal", "savedSourceCloud", "savedSourceCommunity",
    "savedSourceSynced", "savedSourceSyncedTitle", "savedSourceLocalTitle", "savedSourceCloudTitle", "savedErrorAdd", "savedErrorOpen", "savedErrorToggle",
    "closeSavedCrafts", "shareCanvasCloud", "shareWidget", "snapshotCloudSignInRequired", "snapshotCloudSignInHint",
    "openPenEchoCloud", "openPenEchoCloudExternal", "opensInNewTab", "openCloudCanvasUnsaved", "openInNewPage",
    "openCanvas", "addToCanvas", "favorites", "all", "canvases", "widgets", "favoriteCanvases", "favoriteWidgets", "projects", "explore",
  ];
  for (const key of bilingualKeys) {
    assert.match(app, new RegExp(`\\b${key}:`), `English locale is missing ${key}`);
    assert.match(locale, new RegExp(`\\b${key}:`), `Chinese locale is missing ${key}`);
  }
  assert.match(app, /const t = \(key\) => I18N\[state\.language\]\?\.\[key\] \|\| I18N\.en\[key\] \|\| key;/);
  assert.match(app, /window\.PenEchoI18n = Object\.freeze\(\{[\s\S]*?\bt,[\s\S]*?currentLanguage:\(\) => state\.language/);
});

test("personal favorite synchronization is local-to-Cloud only", () => {
  const script = read("public/cloud-connect.js");
  const synchronization = script.slice(script.indexOf("async function syncLocalFavorites"), script.indexOf("const FAVORITE_PAGE_SIZE"));
  assert.match(synchronization, /localFavorites\(\)/);
  assert.match(synchronization, /method:"POST"/);
  assert.doesNotMatch(synchronization, /fullCloudFavorite|saveLocalFavorite\(\{ name:fullEntry|removeLocalFavorite/);
  assert.doesNotMatch(script, /favoriteTombstones|rememberFavoriteTombstone/);
  assert.match(script, /if \(source\.entry\.cloudId\)[\s\S]*?method:"DELETE"/, "removing a local favorite also removes its associated private Cloud copy");
});
