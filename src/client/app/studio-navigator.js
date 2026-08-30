// Studio-only navigator for recent Agent conversations and saved canvases.
  {
    const STUDIO_NAVIGATOR_OPEN_KEY = "penecho-studio-navigator-open",
      STUDIO_NAVIGATOR_TAB_KEY = "penecho-studio-navigator-tab",
      studioNavigatorToggle = document.querySelector("#studioNavigatorToggle"),
      studioNavigator = document.querySelector("#studioNavigator"),
      studioNavigatorClose = document.querySelector("#studioNavigatorClose"),
      studioNavigatorScrim = document.querySelector("#studioNavigatorScrim"),
      studioNavigatorSearch = document.querySelector("#studioNavigatorSearch"),
      studioNavigatorAgentTab = document.querySelector("#studioNavigatorAgentTab"),
      studioNavigatorCanvasTab = document.querySelector("#studioNavigatorCanvasTab"),
      studioNavigatorAgentPanel = document.querySelector("#studioNavigatorAgentPanel"),
      studioNavigatorCanvasPanel = document.querySelector("#studioNavigatorCanvasPanel"),
      studioAgentRecentList = document.querySelector("#studioAgentRecentList"),
      studioCanvasRecentList = document.querySelector("#studioCanvasRecentList"),
      studioNavigatorManage = document.querySelector("#studioNavigatorManage"),
      canvasDocumentMeta = document.querySelector("#canvasDocumentMeta"),
      canvasDocumentName = document.querySelector("#canvasDocumentName"),
      canvasDocumentSaveState = document.querySelector("#canvasDocumentSaveState"),
      canvasDocumentSaveLabel = document.querySelector("#canvasDocumentSaveLabel"),
      saveCanvasLabel = document.querySelector("#saveCanvasLabel"),
      canvasWelcome = document.querySelector("#canvasWelcome"),
      studioNavigatorCompactMedia = window.matchMedia?.("(max-width: 1100px)");
    let studioNavigatorOpenPreference = storedStudioNavigatorOpen(),
      studioNavigatorActiveTab = storedStudioNavigatorTab(),
      studioNavigatorPreviewUrls = new Set(),
      studioNavigatorPendingConversation = null;

    function storedStudioNavigatorOpen() {
      try { return localStorage.getItem(STUDIO_NAVIGATOR_OPEN_KEY) !== "false"; }
      catch { return true; }
    }
    function storedStudioNavigatorTab() {
      try { return localStorage.getItem(STUDIO_NAVIGATOR_TAB_KEY) === "canvas" ? "canvas" : "agent"; }
      catch { return "agent"; }
    }
    function studioNavigatorIsCompact() {
      return Boolean(studioNavigatorCompactMedia?.matches);
    }
    function studioNavigatorIsStudio() {
      return state.theme === "studio";
    }
    function studioNavigatorIsOpen() {
      return studioNavigatorIsStudio() && document.body.classList.contains("studio-navigator-open");
    }
    function studioCanvasHasContent() {
      return Boolean(tiles.size || state.images.length || state.textBoxes.length || state.preservedSnapshotAnimations.length || (pluginEnabled("animation") && state.animations.length) || visibleWidgets().length);
    }
    function updateStudioDocumentState() {
      const active = studioNavigatorIsStudio(), saved = Boolean(state.currentSnapshotId), edited = saved && canvasHasUnsavedChanges(),
        stateKey = snapshotSaveInProgress ? "saving" : !saved ? "unsaved" : edited ? "edited" : "saved",
        copyKey = {
          unsaved:"canvasSaveStateUnsaved",
          saved:"canvasSaveStateSaved",
          edited:"canvasSaveStateEdited",
          saving:"canvasSaveStateSaving",
        }[stateKey];
      canvasDocumentMeta.hidden = !active;
      canvasDocumentName.textContent = state.currentSnapshotName || t("canvasUntitledName");
      canvasDocumentName.title = canvasDocumentName.textContent;
      canvasDocumentSaveState.dataset.state = stateKey;
      canvasDocumentSaveLabel.textContent = t(copyKey);
      saveCanvasLabel.textContent = t(snapshotSaveInProgress ? "snapshotSavingShort" : "saveCurrentSnapshot");
      canvasWelcome.hidden = !active || state.viewMode || studioCanvasHasContent();
    }
    function updateStudioNavigatorSurfaceInert() {
      const blocked = studioNavigatorIsStudio() && studioNavigatorIsOpen() && studioNavigatorIsCompact() && !state.viewMode;
      if (blocked && !view.hasAttribute("inert")) {
        view.inert = true;
        view.dataset.studioNavigatorInert = "true";
      } else if (!blocked && view.dataset.studioNavigatorInert === "true") {
        view.inert = false;
        delete view.dataset.studioNavigatorInert;
      }
    }
    function updateStudioNavigatorA11y() {
      const active = studioNavigatorIsStudio(), open = active && studioNavigatorIsOpen(), unavailable = !active || !open || state.viewMode;
      studioNavigatorToggle.hidden = !active;
      studioNavigator.hidden = !active;
      studioNavigator.inert = unavailable;
      studioNavigator.setAttribute("aria-hidden", String(unavailable));
      studioNavigatorToggle.setAttribute("aria-expanded", String(open));
      studioNavigatorToggle.classList.toggle("active", open);
      const toggleKey = open ? "studioNavigatorClose" : "studioNavigatorOpen";
      studioNavigatorToggle.setAttribute("aria-label", t(toggleKey));
      studioNavigatorToggle.setAttribute("title", t(toggleKey));
      studioNavigatorScrim.hidden = !(active && open && studioNavigatorIsCompact() && !state.viewMode);
      updateStudioNavigatorSurfaceInert();
    }
    function setStudioNavigatorOpen(open, { focus = false, persist = true } = {}) {
      studioNavigatorOpenPreference = Boolean(open);
      if (persist) {
        try { localStorage.setItem(STUDIO_NAVIGATOR_OPEN_KEY, String(studioNavigatorOpenPreference)); }
        catch {}
      }
      document.body.classList.toggle("studio-navigator-open", studioNavigatorIsStudio() && studioNavigatorOpenPreference);
      updateStudioNavigatorA11y();
      if (!open && studioNavigator.contains(document.activeElement)) studioNavigatorToggle.focus({ preventScroll:true });
      else if (open && focus) requestAnimationFrame(() => studioNavigatorSearch.focus({ preventScroll:true }));
    }
    function syncStudioNavigatorTheme(theme = state.theme) {
      const active = theme === "studio";
      document.body.classList.toggle("studio-navigator-enabled", active);
      document.body.classList.toggle("studio-navigator-open", active && studioNavigatorOpenPreference);
      updateStudioNavigatorA11y();
      updateStudioDocumentState();
      if (active) renderStudioNavigator();
    }
    function setStudioNavigatorCanvasView(enabled) {
      if (enabled && studioNavigator.contains(document.activeElement)) document.activeElement.blur();
      updateStudioNavigatorA11y();
      updateStudioDocumentState();
    }
    function studioNavigatorSearchQuery() {
      return String(studioNavigatorSearch.value || "").trim().toLocaleLowerCase(state.language === "zh" ? "zh-CN" : "en");
    }
    function studioNavigatorEmpty(list, key, role = "status") {
      const empty = document.createElement("div");
      empty.className = "studio-navigator-empty";
      empty.setAttribute("role", role);
      empty.textContent = t(key);
      list.replaceChildren(empty);
    }
    function studioNavigatorMetaTime(value) {
      return canvasAgentHistoryTime(Number(value) || Date.now());
    }
    function closeStudioNavigatorAfterCompactAction() {
      if (studioNavigatorIsCompact()) setStudioNavigatorOpen(false);
    }
    function studioNavigatorCanvasIdentity(canvasKey) {
      const match=/^(device|server|cloud):(.+)$/.exec(String(canvasKey||""));
      return match?{location:match[1],id:match[2]}:null;
    }
    function studioNavigatorCanvasGroupName(group) {
      if(group.canvasKey===state.canvasAgentCanvasKey)return state.currentSnapshotName||t("canvasUntitledName");
      const identity=studioNavigatorCanvasIdentity(group.canvasKey),metadata=identity&&snapshotItemsLocation===identity.location?snapshotItems.find(item=>item.id===identity.id):null;
      return group.name||(metadata?snapshotName(metadata):t("studioNavigatorUnknownCanvas"));
    }
    async function openStudioConversationOnCurrentCanvas(pending) {
      if(!pending||pending.canvasKey!==state.canvasAgentCanvasKey)return false;
      studioNavigatorPendingConversation=null;
      studioNavigator.removeAttribute("aria-busy");
      if(canvasAgent.projectId)await canvasAgentSelectProject("");
      const conversation=canvasAgentHistoryForCanvas(pending.canvasKey).find(item=>item.id===pending.conversationId);
      if(!conversation){setStatus(t("studioNavigatorConversationUnavailable"));renderStudioAgentHistory();return false;}
      if(canvasAgentPanel.hidden)openCanvasAgent({focus:false,connect:false});
      await canvasAgentViewStoredConversation(conversation.id);
      renderStudioAgentHistory();
      return true;
    }
    async function openStudioConversation(group,conversation,control) {
      closeStudioNavigatorAfterCompactAction();
      const pending={canvasKey:group.canvasKey,conversationId:conversation.id};
      studioNavigatorPendingConversation=pending;
      studioNavigator.setAttribute("aria-busy","true");
      control.disabled=true;
      try{
        if(group.canvasKey===state.canvasAgentCanvasKey)return await openStudioConversationOnCurrentCanvas(pending);
        const identity=studioNavigatorCanvasIdentity(group.canvasKey);
        if(!identity)throw Error(t("studioNavigatorCanvasUnavailable"));
        const loaded=await requestLoadSnapshot(identity.id,identity.location);
        if(!loaded&&!document.querySelector("#newCanvasDialog").open){
          studioNavigatorPendingConversation=null;
          studioNavigator.removeAttribute("aria-busy");
          setStatus(t("studioNavigatorCanvasUnavailable"));
        }
        return loaded;
      }catch(error){
        studioNavigatorPendingConversation=null;
        studioNavigator.removeAttribute("aria-busy");
        setStatus(`${t("snapshotError")}${String(error?.message||error)}`);
        return false;
      }finally{control.disabled=false;}
    }
    function studioNavigatorCanvasDidLoad(identity) {
      const key=identity?.id&&identity?.location?`${identity.location}:${identity.id}`:"";
      if(!studioNavigatorPendingConversation||studioNavigatorPendingConversation.canvasKey!==key)return false;
      void openStudioConversationOnCurrentCanvas(studioNavigatorPendingConversation).catch(error=>{
        studioNavigatorPendingConversation=null;
        studioNavigator.removeAttribute("aria-busy");
        setStatus(`${t("snapshotError")}${String(error?.message||error)}`);
      });
      return true;
    }
    function wantsStudioConversationForCanvas(identity) {
      const key=identity?.id&&identity?.location?`${identity.location}:${identity.id}`:"";
      return Boolean(key&&studioNavigatorPendingConversation?.canvasKey===key);
    }
    function cancelStudioPendingConversation() {
      studioNavigatorPendingConversation=null;
      studioNavigator.removeAttribute("aria-busy");
      renderStudioAgentHistory();
    }
    function renderStudioAgentHistory() {
      if (!studioAgentRecentList) return;
      const query=studioNavigatorSearchQuery(),groups=canvasAgentStoredHistoryGroups().filter(group=>!group.canvasKey.startsWith("draft:")||group.canvasKey===state.canvasAgentCanvasKey).map(group=>{
        const name=studioNavigatorCanvasGroupName(group),conversations=query?group.conversations.filter(conversation=>`${name} ${conversation.title||t("canvasAgentHistoryUntitled")}`.toLocaleLowerCase(state.language==="zh"?"zh-CN":"en").includes(query)):group.conversations;
        return {...group,name,conversations};
      }).filter(group=>group.conversations.length).sort((a,b)=>b.updatedAt-a.updatedAt);
      studioAgentRecentList.replaceChildren();
      if (!groups.length) {
        studioNavigatorEmpty(studioAgentRecentList, query ? "studioNavigatorAgentNoMatch" : "studioNavigatorAgentEmpty");
        return;
      }
      for (const group of groups) {
        const section=document.createElement("section"),heading=document.createElement("div"),canvasIcon=document.createElement("span"),headingBody=document.createElement("span"),name=document.createElement("strong"),meta=document.createElement("small"),list=document.createElement("div"),identity=studioNavigatorCanvasIdentity(group.canvasKey),canvasCurrent=group.canvasKey===state.canvasAgentCanvasKey;
        section.className="studio-navigator-group";
        section.dataset.canvasKey=group.canvasKey;
        heading.className="studio-navigator-group-heading";
        canvasIcon.className="studio-navigator-item-icon canvas";
        headingBody.className="studio-navigator-item-body";
        name.textContent=group.name;
        meta.textContent=[identity?snapshotLocationLabel(identity.location):t("studioNavigatorDraftCanvas"),t("studioNavigatorSessionCount").replace("{count}",String(group.conversations.length)),studioNavigatorMetaTime(group.updatedAt),canvasCurrent?t("canvasAgentHistoryCurrent"):""].filter(Boolean).join(" · ");
        headingBody.append(name,meta);heading.append(canvasIcon,headingBody);
        list.className="studio-navigator-group-conversations";
        for (const conversation of group.conversations) {
          const row=document.createElement("button"),icon=document.createElement("span"),body=document.createElement("span"),title=document.createElement("strong"),rowMeta=document.createElement("small"),current=canvasCurrent&&conversation.id===canvasAgent.currentConversation?.id,messageCount=conversation.items.filter(item=>item?.type==="message"&&["user","assistant"].includes(item.role)).length;
          row.type="button";row.className="studio-navigator-item studio-navigator-conversation";row.dataset.conversationId=conversation.id;row.classList.toggle("current",current);
          if(current)row.setAttribute("aria-current","page");
          icon.className="studio-navigator-item-icon agent";
          icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 13.7 8.6a2 2 0 0 0 1.2 1.2l5.1 1.7-5.1 1.7a2 2 0 0 0-1.2 1.2L12 19.5l-1.7-5.1a2 2 0 0 0-1.2-1.2L4 11.5l5.1-1.7a2 2 0 0 0 1.2-1.2Z"/></svg>';
          body.className="studio-navigator-item-body";title.textContent=conversation.title||t("canvasAgentHistoryUntitled");
          rowMeta.textContent=[t("studioNavigatorMessageCount").replace("{count}",String(messageCount)),studioNavigatorMetaTime(conversation.updatedAt),current?t("canvasAgentHistoryCurrent"):""].filter(Boolean).join(" · ");
          body.append(title,rowMeta);row.append(icon,body);
          row.addEventListener("click",()=>void openStudioConversation(group,conversation,row));
          list.append(row);
        }
        section.append(heading,list);studioAgentRecentList.append(section);
      }
    }
    function releaseStudioNavigatorPreviewUrls() {
      for (const url of studioNavigatorPreviewUrls) URL.revokeObjectURL(url);
      studioNavigatorPreviewUrls.clear();
    }
    function studioNavigatorCanvasPreview(item) {
      const preview = document.createElement("span"), image = document.createElement("img");
      preview.className = "studio-navigator-item-icon canvas";
      image.alt = "";
      if (item.preview instanceof Blob) {
        const url = URL.createObjectURL(item.preview);
        studioNavigatorPreviewUrls.add(url);
        image.src = url;
        image.onload = image.onerror = () => {
          URL.revokeObjectURL(url);
          studioNavigatorPreviewUrls.delete(url);
        };
      }
      preview.append(image);
      return preview;
    }
    function renderStudioCanvasHistory() {
      if (!studioCanvasRecentList) return;
      releaseStudioNavigatorPreviewUrls();
      const location = state.snapshotLocation;
      if (snapshotListInProgress && snapshotItemsLocation !== location) {
        studioNavigatorEmpty(studioCanvasRecentList, "studioNavigatorCanvasLoading");
        return;
      }
      if (snapshotItemsLocation !== location) {
        studioNavigatorEmpty(studioCanvasRecentList, "studioNavigatorCanvasLoading");
        return;
      }
      const items = snapshotItemsForCurrentView().slice().sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)),
        query = studioNavigatorSearchQuery(),
        filtered = (query ? items.filter((item) => snapshotName(item).toLocaleLowerCase(state.language === "zh" ? "zh-CN" : "en").includes(query)) : items).slice(0, 7);
      studioCanvasRecentList.replaceChildren();
      if (!filtered.length) {
        studioNavigatorEmpty(studioCanvasRecentList, items.length ? "studioNavigatorCanvasNoMatch" : "studioNavigatorCanvasEmpty");
        return;
      }
      for (const item of filtered) {
        const row = document.createElement("button"), body = document.createElement("span"), title = document.createElement("strong"),
          meta = document.createElement("small"), current = item.id === state.currentSnapshotId && location === state.currentSnapshotLocation;
        row.type = "button";
        row.className = "studio-navigator-item";
        row.dataset.snapshotId = item.id;
        row.classList.toggle("current", current);
        if (current) row.setAttribute("aria-current", "page");
        body.className = "studio-navigator-item-body";
        title.textContent = snapshotName(item);
        meta.textContent = [snapshotLocationLabel(location), studioNavigatorMetaTime(item.updatedAt || item.createdAt), current ? t("canvasAgentHistoryCurrent") : ""].filter(Boolean).join(" · ");
        body.append(title, meta);
        row.append(studioNavigatorCanvasPreview(item), body);
        row.addEventListener("click", () => {
          closeStudioNavigatorAfterCompactAction();
          void runSnapshotLoadAction(row, () => requestLoadSnapshot(item.id, location));
        });
        studioCanvasRecentList.append(row);
      }
    }
    function setStudioNavigatorTab(tab, { focus = false, persist = true } = {}) {
      studioNavigatorActiveTab = tab === "canvas" ? "canvas" : "agent";
      const canvasActive = studioNavigatorActiveTab === "canvas";
      studioNavigatorAgentTab.setAttribute("aria-selected", String(!canvasActive));
      studioNavigatorCanvasTab.setAttribute("aria-selected", String(canvasActive));
      studioNavigatorAgentTab.tabIndex = canvasActive ? -1 : 0;
      studioNavigatorCanvasTab.tabIndex = canvasActive ? 0 : -1;
      studioNavigatorAgentPanel.hidden = canvasActive;
      studioNavigatorCanvasPanel.hidden = !canvasActive;
      const manageKey = canvasActive ? "studioNavigatorManageCanvases" : "studioNavigatorManageAgents";
      studioNavigatorManage.querySelector("span").dataset.i18n = manageKey;
      studioNavigatorManage.querySelector("span").textContent = t(manageKey);
      if (persist) {
        try { localStorage.setItem(STUDIO_NAVIGATOR_TAB_KEY, studioNavigatorActiveTab); }
        catch {}
      }
      if (canvasActive) renderStudioCanvasHistory();
      else renderStudioAgentHistory();
      if (focus) (canvasActive ? studioNavigatorCanvasTab : studioNavigatorAgentTab).focus({ preventScroll:true });
    }
    function renderStudioNavigator() {
      renderStudioAgentHistory();
      renderStudioCanvasHistory();
      setStudioNavigatorTab(studioNavigatorActiveTab, { persist:false });
      updateStudioNavigatorA11y();
      updateStudioDocumentState();
    }
    function openStudioAgentHistoryManager() {
      closeStudioNavigatorAfterCompactAction();
      if (canvasAgentPanel.hidden) openCanvasAgent({ focus:false });
      requestAnimationFrame(() => {
        if (canvasAgentHistoryPopover.hidden) canvasAgentHistory.click();
        canvasAgentHistory.focus({ preventScroll:true });
      });
    }
    function openStudioCanvasHistoryManager() {
      closeStudioNavigatorAfterCompactAction();
      openHistoryPanel();
    }
    function handleStudioNavigatorTabKeydown(event) {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const canvas = event.key === "ArrowRight" || event.key === "End";
      setStudioNavigatorTab(canvas ? "canvas" : "agent", { focus:true });
    }

    studioNavigatorToggle.addEventListener("click", () => setStudioNavigatorOpen(!studioNavigatorIsOpen(), { focus:!studioNavigatorIsOpen() && studioNavigatorIsCompact() }));
    studioNavigatorClose.addEventListener("click", () => setStudioNavigatorOpen(false));
    studioNavigatorScrim.addEventListener("click", () => setStudioNavigatorOpen(false));
    studioNavigatorSearch.addEventListener("input", () => studioNavigatorActiveTab === "canvas" ? renderStudioCanvasHistory() : renderStudioAgentHistory());
    studioNavigatorAgentTab.addEventListener("click", () => setStudioNavigatorTab("agent"));
    studioNavigatorCanvasTab.addEventListener("click", () => setStudioNavigatorTab("canvas"));
    studioNavigatorAgentTab.addEventListener("keydown", handleStudioNavigatorTabKeydown);
    studioNavigatorCanvasTab.addEventListener("keydown", handleStudioNavigatorTabKeydown);
    studioNavigatorManage.addEventListener("click", () => studioNavigatorActiveTab === "canvas" ? openStudioCanvasHistoryManager() : openStudioAgentHistoryManager());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && studioNavigatorIsCompact() && studioNavigatorIsOpen() && studioNavigator.contains(document.activeElement)) {
        event.preventDefault();
        setStudioNavigatorOpen(false);
      }
    });
    studioNavigatorCompactMedia?.addEventListener?.("change", updateStudioNavigatorA11y);
    window.addEventListener("penecho:languagechange", renderStudioNavigator);
    window.PenEchoStudioNavigator = Object.freeze({
      render:renderStudioNavigator,
      renderAgent:renderStudioAgentHistory,
      renderCanvases:renderStudioCanvasHistory,
      updateDocument:updateStudioDocumentState,
      canvasDidLoad:studioNavigatorCanvasDidLoad,
      wantsConversationForCanvas:wantsStudioConversationForCanvas,
      cancelPendingConversation:cancelStudioPendingConversation,
      setOpen:setStudioNavigatorOpen,
      syncCanvasView:setStudioNavigatorCanvasView,
      syncTheme:syncStudioNavigatorTheme,
    });
    setStudioNavigatorTab(studioNavigatorActiveTab, { persist:false });
    syncStudioNavigatorTheme(state.theme);
  }
