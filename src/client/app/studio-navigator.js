// Studio-only navigator for recent Agent conversations and saved canvases.
  {
    const STUDIO_NAVIGATOR_TAB_KEY = "penecho-studio-navigator-tab",
      STUDIO_EDGE_SWIPE_START_PX = 28,
      STUDIO_EDGE_SWIPE_COMMIT_PX = 56,
      STUDIO_EDGE_SWIPE_CANCEL_PX = 36,
      STUDIO_EDGE_SWIPE_DIRECTION_RATIO = 1.25,
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
      studioSessionDeleteDialog = document.querySelector("#studioSessionDeleteDialog"),
      studioSessionDeleteDescription = document.querySelector("#studioSessionDeleteDescription"),
      studioSessionDeleteCancel = document.querySelector("#studioSessionDeleteCancel"),
      studioSessionDeleteConfirm = document.querySelector("#studioSessionDeleteConfirm"),
      canvasDocumentMeta = document.querySelector("#canvasDocumentMeta"),
      canvasDocumentName = document.querySelector("#canvasDocumentName"),
      canvasDocumentNameLabel = document.querySelector("#canvasDocumentNameLabel"),
      canvasDocumentNameInput = document.querySelector("#canvasDocumentNameInput"),
      canvasDocumentSaveState = document.querySelector("#canvasDocumentSaveState"),
      canvasDocumentSaveLabel = document.querySelector("#canvasDocumentSaveLabel"),
      saveCanvasLabel = document.querySelector("#saveCanvasLabel"),
      canvasWelcome = document.querySelector("#canvasWelcome"),
      studioNavigatorCompactMedia = window.matchMedia?.("(max-width: 1100px)");
    let studioNavigatorOpenPreference = false,
      studioNavigatorActiveTab = storedStudioNavigatorTab(),
      studioNavigatorAgentPreviewUrls = new Set(),
      studioNavigatorCanvasPreviewUrls = new Set(),
      studioNavigatorCanvasGroupSnapshots = new Map(),
      studioNavigatorCanvasGroupSnapshotLoads = new Map(),
      studioNavigatorCanvasGroupSnapshotRetryAt = new Map(),
      studioNavigatorDraftSnapshot = {canvasKey:"",revision:-1,item:null,request:null,retryAt:0},
      studioNavigatorPendingConversation = null,
      studioSessionDeletePending = null,
      canvasDocumentRenameActive = false,
      canvasDocumentRenameCommitting = false,
      studioEdgeSwipe = null;

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
      const active = studioNavigatorIsStudio(), saved = Boolean(state.currentSnapshotId), edited = saved && (canvasHasUnsavedChanges() || Boolean(state.currentCanvasSuggestedName)),
        stateKey = snapshotSaveInProgress ? "saving" : !saved ? "unsaved" : edited ? "edited" : "saved",
        documentName = currentCanvasDisplayName() || t("canvasUntitledName"),
        copyKey = {
          unsaved:"canvasSaveStateUnsaved",
          saved:"canvasSaveStateSaved",
          edited:"canvasSaveStateEdited",
          saving:"canvasSaveStateSaving",
        }[stateKey];
      canvasDocumentMeta.hidden = !active;
      canvasDocumentNameLabel.textContent = documentName;
      canvasDocumentName.title = t("canvasRenameNamed").replace("{name}", documentName);
      canvasDocumentName.setAttribute("aria-label", t("canvasRenameNamed").replace("{name}", documentName));
      canvasDocumentNameInput.disabled = snapshotSaveInProgress;
      canvasDocumentNameInput.setAttribute("aria-busy", String(snapshotSaveInProgress));
      canvasDocumentSaveState.dataset.state = stateKey;
      canvasDocumentSaveLabel.textContent = t(copyKey);
      saveCanvasLabel.textContent = t(snapshotSaveInProgress ? "snapshotSavingShort" : "saveCurrentSnapshot");
      canvasWelcome.hidden = !active || state.viewMode || studioCanvasHasContent();
    }
    function finishCanvasDocumentRename({ focus = false } = {}) {
      canvasDocumentRenameActive = false;
      canvasDocumentRenameCommitting = false;
      canvasDocumentNameInput.hidden = true;
      canvasDocumentNameInput.disabled = false;
      canvasDocumentNameInput.setCustomValidity("");
      canvasDocumentName.hidden = false;
      updateStudioDocumentState();
      if (focus) canvasDocumentName.focus({ preventScroll:true });
    }
    function beginCanvasDocumentRename() {
      if (!studioNavigatorIsStudio() || state.viewMode || snapshotSaveInProgress || canvasDocumentRenameActive) return;
      canvasDocumentRenameActive = true;
      canvasDocumentNameInput.value = currentCanvasDisplayName() || "";
      canvasDocumentNameInput.setCustomValidity("");
      canvasDocumentName.hidden = true;
      canvasDocumentNameInput.hidden = false;
      canvasDocumentNameInput.focus({ preventScroll:true });
      canvasDocumentNameInput.select();
    }
    async function commitCanvasDocumentRename() {
      if (!canvasDocumentRenameActive || canvasDocumentRenameCommitting) return;
      const name = canvasDocumentNameInput.value.trim().slice(0, 48);
      if (!name) {
        canvasDocumentNameInput.setCustomValidity(t("canvasNameRequired"));
        canvasDocumentNameInput.reportValidity();
        canvasDocumentNameInput.focus({ preventScroll:true });
        return;
      }
      if (name === currentCanvasDisplayName()) {
        finishCanvasDocumentRename();
        return;
      }
      canvasDocumentRenameCommitting = true;
      canvasDocumentNameInput.disabled = true;
      const saved = await renameCurrentCanvasFromTitle(name);
      if (saved) finishCanvasDocumentRename();
      else {
        canvasDocumentRenameCommitting = false;
        canvasDocumentNameInput.disabled = false;
        canvasDocumentNameInput.focus({ preventScroll:true });
        canvasDocumentNameInput.select();
      }
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
    function setStudioNavigatorOpen(open, { focus = false } = {}) {
      studioNavigatorOpenPreference = Boolean(open);
      document.body.classList.toggle("studio-navigator-open", studioNavigatorIsStudio() && studioNavigatorOpenPreference);
      updateStudioNavigatorA11y();
      if(open&&studioNavigatorIsStudio())(studioNavigatorActiveTab==="canvas"?renderStudioCanvasHistory:renderStudioAgentHistory)();
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
    function collapseStudioNavigatorForWorkspaceFocus() {
      if (studioNavigatorIsOpen()) setStudioNavigatorOpen(false);
    }
    function studioNavigatorCanvasIdentity(canvasKey) {
      const match=/^(device|server|cloud):(.+)$/.exec(String(canvasKey||""));
      return match?{location:match[1],id:match[2]}:null;
    }
    function studioNavigatorCanvasGroupSnapshot(group) {
      const canvasKey=String(group?.canvasKey||"");
      if(canvasKey.startsWith("draft:"))return canvasKey===state.canvasAgentCanvasKey&&studioNavigatorDraftSnapshot.canvasKey===canvasKey&&studioNavigatorDraftSnapshot.revision===state.userRevision?studioNavigatorDraftSnapshot.item:null;
      const identity=studioNavigatorCanvasIdentity(group?.canvasKey);
      if(!identity)return null;
      const key=`${identity.location}:${identity.id}`;
      if(snapshotItemsLocation===identity.location){
        const item=snapshotItems.find(candidate=>candidate.id===identity.id)||null;
        if(item){studioNavigatorCanvasGroupSnapshots.set(key,item);studioNavigatorCanvasGroupSnapshotRetryAt.delete(key);}
        else studioNavigatorCanvasGroupSnapshots.delete(key);
        return item;
      }
      return studioNavigatorCanvasGroupSnapshots.get(key)||null;
    }
    async function studioNavigatorLoadDraftSnapshot(request) {
      try{
        const preview=await snapshotPreviewBlob();
        if(request===studioNavigatorDraftSnapshot.request&&request.canvasKey===state.canvasAgentCanvasKey&&request.revision===state.userRevision){
          studioNavigatorDraftSnapshot.canvasKey=request.canvasKey;
          studioNavigatorDraftSnapshot.revision=request.revision;
          studioNavigatorDraftSnapshot.item={id:request.canvasKey,preview};
          studioNavigatorDraftSnapshot.retryAt=0;
        }
      }catch{
        if(request===studioNavigatorDraftSnapshot.request)studioNavigatorDraftSnapshot.retryAt=Date.now()+30_000;
      }finally{
        if(request===studioNavigatorDraftSnapshot.request)studioNavigatorDraftSnapshot.request=null;
        if(studioNavigatorIsStudio()&&studioNavigatorActiveTab==="agent")renderStudioAgentHistory();
      }
    }
    function studioNavigatorQueueDraftSnapshot(group) {
      const canvasKey=String(group?.canvasKey||""),revision=state.userRevision,current=studioNavigatorDraftSnapshot.request;
      if(!canvasKey.startsWith("draft:")||canvasKey!==state.canvasAgentCanvasKey||studioNavigatorCanvasGroupSnapshot(group))return;
      if(studioNavigatorDraftSnapshot.retryAt>Date.now())return;
      if(current?.canvasKey===canvasKey&&current.revision===revision)return;
      const request={canvasKey,revision};
      studioNavigatorDraftSnapshot.request=request;
      void studioNavigatorLoadDraftSnapshot(request);
    }
    async function studioNavigatorLoadCanvasGroupSnapshots(location,request) {
      try{
        const items=snapshotItemsLocation===location?snapshotItems:await snapshotsAt(location),byId=new Map(items.map(item=>[item.id,item]));
        for(const [id,key] of request.ids){
          const item=byId.get(id)||null;
          if(item){studioNavigatorCanvasGroupSnapshots.set(key,item);studioNavigatorCanvasGroupSnapshotRetryAt.delete(key);}
          else{studioNavigatorCanvasGroupSnapshots.delete(key);studioNavigatorCanvasGroupSnapshotRetryAt.set(key,Date.now()+30_000);}
        }
      }catch{
        for(const key of request.ids.values())studioNavigatorCanvasGroupSnapshotRetryAt.set(key,Date.now()+30_000);
      }finally{
        studioNavigatorCanvasGroupSnapshotLoads.delete(location);
        if(studioNavigatorIsStudio()&&studioNavigatorActiveTab==="agent")renderStudioAgentHistory();
      }
    }
    function studioNavigatorQueueCanvasGroupSnapshots(groups) {
      const now=Date.now(),byLocation=new Map();
      for(const group of groups){
        const identity=studioNavigatorCanvasIdentity(group.canvasKey),key=identity?`${identity.location}:${identity.id}`:"";
        if(!identity){studioNavigatorQueueDraftSnapshot(group);continue;}
        if(studioNavigatorCanvasGroupSnapshot(group)||studioNavigatorCanvasGroupSnapshotRetryAt.get(key)>now)continue;
        if(state.snapshotLocation===identity.location&&snapshotListInProgress)continue;
        if(!byLocation.has(identity.location))byLocation.set(identity.location,new Map());
        byLocation.get(identity.location).set(identity.id,key);
      }
      for(const [location,ids] of byLocation){
        const pending=studioNavigatorCanvasGroupSnapshotLoads.get(location);
        if(pending){for(const [id,key] of ids)pending.ids.set(id,key);continue;}
        const request={ids};
        studioNavigatorCanvasGroupSnapshotLoads.set(location,request);
        void studioNavigatorLoadCanvasGroupSnapshots(location,request);
      }
    }
    function studioNavigatorCanvasGroupName(group) {
      if(group.canvasKey===state.canvasAgentCanvasKey)return currentCanvasDisplayName()||t("canvasUntitledName");
      const metadata=studioNavigatorCanvasGroupSnapshot(group);
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
    function openStudioSessionDeleteDialog(group,conversation) {
      const title=conversation.title||t("canvasAgentHistoryUntitled"),current=group.canvasKey===state.canvasAgentCanvasKey&&conversation.id===canvasAgent.currentConversation?.id,busy=current&&(canvasAgent.requestPending||canvasAgent.running);
      studioSessionDeletePending={canvasKey:group.canvasKey,conversationId:conversation.id};
      studioSessionDeleteDescription.textContent=t(busy?"studioNavigatorDeleteSessionBusy":"studioNavigatorDeleteSessionConfirm").replace("{name}",title);
      studioSessionDeleteConfirm.disabled=busy;
      if(!studioSessionDeleteDialog.open)studioSessionDeleteDialog.showModal();
      requestAnimationFrame(()=>studioSessionDeleteCancel.focus({preventScroll:true}));
    }
    function confirmStudioSessionDelete() {
      if(!studioSessionDeletePending)return false;
      const result=canvasAgentDeleteStoredConversation(studioSessionDeletePending.canvasKey,studioSessionDeletePending.conversationId);
      if(!result.deleted){
        const key=result.reason==="busy"?"studioNavigatorDeleteSessionBusy":"studioNavigatorDeleteSessionFailed";
        studioSessionDeleteDescription.textContent=t(key);
        studioSessionDeleteConfirm.disabled=result.reason==="busy";
        return false;
      }
      studioSessionDeleteDialog.close("deleted");
      renderStudioAgentHistory();
      return true;
    }
    function renderStudioAgentHistory() {
      if (!studioAgentRecentList) return;
      releaseStudioNavigatorPreviewUrls(studioNavigatorAgentPreviewUrls);
      const query=studioNavigatorSearchQuery(),groups=canvasAgentStoredHistoryGroups().filter(group=>!group.canvasKey.startsWith("draft:")).map(group=>{
        const name=studioNavigatorCanvasGroupName(group),conversations=query?group.conversations.filter(conversation=>`${name} ${conversation.title||t("canvasAgentHistoryUntitled")}`.toLocaleLowerCase(state.language==="zh"?"zh-CN":"en").includes(query)):group.conversations;
        return {...group,name,conversations};
      }).filter(group=>group.conversations.length).sort((a,b)=>b.updatedAt-a.updatedAt);
      studioNavigatorQueueCanvasGroupSnapshots(groups);
      studioAgentRecentList.replaceChildren();
      if (!groups.length) {
        studioNavigatorEmpty(studioAgentRecentList, query ? "studioNavigatorAgentNoMatch" : "studioNavigatorAgentEmpty");
        return;
      }
      for (const group of groups) {
        const section=document.createElement("section"),heading=document.createElement("div"),canvasPreview=studioNavigatorCanvasPreview(studioNavigatorCanvasGroupSnapshot(group),studioNavigatorAgentPreviewUrls),headingBody=document.createElement("span"),name=document.createElement("strong"),meta=document.createElement("small"),list=document.createElement("div"),identity=studioNavigatorCanvasIdentity(group.canvasKey),canvasCurrent=group.canvasKey===state.canvasAgentCanvasKey;
        section.className="studio-navigator-group";
        section.dataset.canvasKey=group.canvasKey;
        heading.className="studio-navigator-group-heading";
        headingBody.className="studio-navigator-item-body";
        name.textContent=group.name;
        meta.textContent=[identity?snapshotLocationLabel(identity.location):t("studioNavigatorDraftCanvas"),t("studioNavigatorSessionCount").replace("{count}",String(group.conversations.length)),studioNavigatorMetaTime(group.updatedAt),canvasCurrent?t("canvasAgentHistoryCurrent"):""].filter(Boolean).join(" · ");
        headingBody.append(name,meta);heading.append(canvasPreview,headingBody);
        list.className="studio-navigator-group-conversations";
        for (const conversation of group.conversations) {
          const entry=document.createElement("div"),row=document.createElement("button"),remove=document.createElement("button"),icon=document.createElement("span"),body=document.createElement("span"),title=document.createElement("strong"),rowMeta=document.createElement("small"),current=canvasCurrent&&conversation.id===canvasAgent.currentConversation?.id,messageCount=conversation.items.filter(item=>item?.type==="message"&&["user","assistant"].includes(item.role)).length,deleteLabel=t("studioNavigatorDeleteSession").replace("{name}",conversation.title||t("canvasAgentHistoryUntitled"));
          entry.className="studio-navigator-conversation-entry";
          row.type="button";row.className="studio-navigator-item studio-navigator-conversation";row.dataset.conversationId=conversation.id;row.classList.toggle("current",current);
          if(current)row.setAttribute("aria-current","page");
          icon.className="studio-navigator-item-icon agent";
          icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 13.7 8.6a2 2 0 0 0 1.2 1.2l5.1 1.7-5.1 1.7a2 2 0 0 0-1.2 1.2L12 19.5l-1.7-5.1a2 2 0 0 0-1.2-1.2L4 11.5l5.1-1.7a2 2 0 0 0 1.2-1.2Z"/></svg>';
          body.className="studio-navigator-item-body";title.textContent=conversation.title||t("canvasAgentHistoryUntitled");
          rowMeta.textContent=[t("studioNavigatorMessageCount").replace("{count}",String(messageCount)),studioNavigatorMetaTime(conversation.updatedAt),current?t("canvasAgentHistoryCurrent"):""].filter(Boolean).join(" · ");
          body.append(title,rowMeta);row.append(icon,body);
          row.addEventListener("click",()=>void openStudioConversation(group,conversation,row));
          remove.type="button";remove.className="studio-navigator-session-delete";remove.setAttribute("aria-label",deleteLabel);remove.title=deleteLabel;
          remove.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';
          remove.addEventListener("click",()=>openStudioSessionDeleteDialog(group,conversation));
          entry.append(row,remove);list.append(entry);
        }
        section.append(heading,list);studioAgentRecentList.append(section);
      }
    }
    function releaseStudioNavigatorPreviewUrls(urls) {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    }
    function studioNavigatorCanvasPreview(item, urls = studioNavigatorCanvasPreviewUrls) {
      const preview = document.createElement("span"), image = document.createElement("img");
      preview.className = "studio-navigator-item-icon canvas";
      image.alt = "";
      if (item?.preview instanceof Blob) {
        const url = URL.createObjectURL(item.preview);
        urls.add(url);
        image.src = url;
        image.onload = image.onerror = () => {
          URL.revokeObjectURL(url);
          urls.delete(url);
        };
      }
      preview.append(image);
      return preview;
    }
    function renderStudioCanvasHistory() {
      if (!studioCanvasRecentList) return;
      releaseStudioNavigatorPreviewUrls(studioNavigatorCanvasPreviewUrls);
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
    function studioEdgeSwipeInteractiveTarget(target) {
      return target instanceof Element && Boolean(target.closest("button, input, textarea, select, a, [contenteditable='true'], [role='button'], [role='separator']"));
    }
    function studioEdgeSwipeSide(event) {
      if (studioEdgeSwipe || event.pointerType !== "touch" || event.isPrimary === false || state.viewMode || !studioNavigatorIsStudio() || studioEdgeSwipeInteractiveTarget(event.target)) return "";
      const bounds = view.getBoundingClientRect(),
        leftInset = event.clientX - bounds.left,
        rightInset = bounds.right - event.clientX;
      if (leftInset >= 0 && leftInset <= STUDIO_EDGE_SWIPE_START_PX && !studioNavigatorIsOpen()) return "left";
      if (rightInset >= 0 && rightInset <= STUDIO_EDGE_SWIPE_START_PX && canvasAgentAvailable() && canvasAgentPanel.hidden && canvasAgentDockedPanel()) return "right";
      return "";
    }
    function consumeStudioEdgeSwipe(event) {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    }
    function beginStudioEdgeSwipe(event) {
      const side = studioEdgeSwipeSide(event);
      if (!side) return;
      consumeStudioEdgeSwipe(event);
      studioEdgeSwipe = {
        pointerId:event.pointerId,
        side,
        startX:event.clientX,
        startY:event.clientY,
        cancelled:false,
        committed:false,
      };
      try { view.setPointerCapture(event.pointerId); }
      catch {}
    }
    function moveStudioEdgeSwipe(event) {
      const gesture = studioEdgeSwipe;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      consumeStudioEdgeSwipe(event);
      if (gesture.cancelled || gesture.committed) return;
      const deltaX = event.clientX - gesture.startX,
        deltaY = Math.abs(event.clientY - gesture.startY),
        inward = gesture.side === "left" ? deltaX : -deltaX;
      if (inward < -STUDIO_EDGE_SWIPE_START_PX / 2 || deltaY > STUDIO_EDGE_SWIPE_CANCEL_PX && deltaY > Math.max(0, inward)) {
        gesture.cancelled = true;
        return;
      }
      if (inward < STUDIO_EDGE_SWIPE_COMMIT_PX || inward < deltaY * STUDIO_EDGE_SWIPE_DIRECTION_RATIO) return;
      gesture.committed = true;
      if (gesture.side === "left") setStudioNavigatorOpen(true, { focus:false });
      else openCanvasAgent({ focus:false });
    }
    function finishStudioEdgeSwipe(event) {
      const gesture = studioEdgeSwipe;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      consumeStudioEdgeSwipe(event);
      studioEdgeSwipe = null;
      if (view.hasPointerCapture?.(event.pointerId)) view.releasePointerCapture(event.pointerId);
    }
    function loseStudioEdgeSwipeCapture(event) {
      if (studioEdgeSwipe?.pointerId === event.pointerId) studioEdgeSwipe = null;
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
    canvasDocumentName.addEventListener("click", beginCanvasDocumentRename);
    canvasDocumentNameInput.addEventListener("input", () => canvasDocumentNameInput.setCustomValidity(""));
    canvasDocumentNameInput.addEventListener("blur", () => void commitCanvasDocumentRename());
    canvasDocumentNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void commitCanvasDocumentRename();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finishCanvasDocumentRename({ focus:true });
      }
    });
    studioSessionDeleteConfirm.addEventListener("click",confirmStudioSessionDelete);
    studioSessionDeleteDialog.addEventListener("close",()=>{
      studioSessionDeletePending=null;
      studioSessionDeleteConfirm.disabled=false;
    });
    view.addEventListener("pointerdown", beginStudioEdgeSwipe, true);
    view.addEventListener("pointermove", moveStudioEdgeSwipe, true);
    view.addEventListener("pointerup", finishStudioEdgeSwipe, true);
    view.addEventListener("pointercancel", finishStudioEdgeSwipe, true);
    view.addEventListener("lostpointercapture", loseStudioEdgeSwipeCapture, true);
    view.addEventListener("pointerdown", collapseStudioNavigatorForWorkspaceFocus, true);
    view.addEventListener("focusin", collapseStudioNavigatorForWorkspaceFocus);
    canvasAgentPanel.addEventListener("pointerdown", collapseStudioNavigatorForWorkspaceFocus, true);
    canvasAgentPanel.addEventListener("focusin", collapseStudioNavigatorForWorkspaceFocus);
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
