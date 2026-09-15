(function initTenetSubmissionSharing() {
  "use strict";
  if (window.PENECHO_CONFIG?.tenetMode !== true) return;

  const MIB = 1024 * 1024;
  const downloads = new Set();
  let activeReport = null;
  let sharing = false;
  const encoder = new TextEncoder();

  function filenameFor(value, extension) {
    const stem = String(value || "Tenet work").replace(/\.(tenet|pdf)$/i, "")
      .replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^[^A-Za-z0-9]+/, "").slice(0, 72);
    return (stem || "Tenet-work") + extension;
  }

  function abortError() { return new Error("This report was closed or its saved-page context changed."); }

  function observedTime(value) {
    if (typeof value !== "string" && typeof value !== "number") return "not recorded";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "not recorded";
  }

  function readBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
      reader.onerror = () => reject(new Error("The file could not be prepared for sharing."));
      reader.onabort = () => reject(abortError());
      reader.readAsDataURL(blob);
    });
  }

  async function shareFile(blob, filename, options = {}) {
    if (!(blob instanceof Blob) || !blob.size) throw new Error("There is no file to share.");
    const extension = /\.pdf$/i.test(filename) ? ".pdf" : ".tenet";
    const limit = extension === ".pdf" ? 24 * MIB : 64 * MIB;
    if (blob.size > limit) throw new Error("This file exceeds the safe sharing limit. No history was removed.");
    if (sharing) throw new Error("Another file is already being shared.");
    const check = () => { if (options.isCurrent && !options.isCurrent()) throw abortError(); };
    const safeName = filenameFor(filename, extension);
    check();
    sharing = true;
    try {
      const native = window.Capacitor?.getPlatform?.() === "ios";
      if (native) {
        const plugin = window.Capacitor?.Plugins?.TenetNative;
        if (typeof plugin?.exportFile === "function") {
          const base64 = await readBase64(blob);
          check();
          try { return await plugin.exportFile({ base64, filename: safeName }); }
          catch (error) {
            if (!/unimplemented|not implemented|not available/i.test(String(error?.code) + " " + String(error?.message))) throw error;
          }
        }
        const file = new File([blob], safeName, { type: extension === ".pdf" ? "application/pdf" : "application/octet-stream" });
        if (navigator.canShare?.({ files: [file] }) && navigator.share) {
          check();
          try { await navigator.share({ files: [file] }); return { cancelled: false }; }
          catch (error) {
            if (error?.name === "AbortError") return { cancelled: true };
            throw new Error("Sharing could not start. Update the Tenet iPad app, then try again.");
          }
        }
        throw new Error("Update the Tenet iPad app to share work files and PDF reports. Your saved work is unchanged.");
      }
      check();
      const url = URL.createObjectURL(blob);
      downloads.add(url);
      const link = document.createElement("a");
      link.href = url; link.download = safeName; link.hidden = true;
      document.body.append(link);
      try { link.click(); } finally { link.remove(); }
      setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 60000);
      return { cancelled: false, downloaded: true };
    } finally { sharing = false; }
  }

  function interactions(events) {
    const source = Array.isArray(events) ? events : [];
    if (source.length > 5000) throw new Error("This report exceeds the supported event count.");
    const counts = new Map(), groups = [], linked = new Map();
    for (const event of source) {
      if (event.type === "ai.request" && typeof event.details?.localRequestId === "string") {
        const id = event.details.localRequestId;
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    for (const event of source) {
      if (event.type !== "ai.request") continue;
      const group = { request: event, responses: [], finishes: [], inputs: [] };
      groups.push(group);
      const id = event.details?.localRequestId;
      if (counts.get(id) === 1) linked.set(id, group);
    }
    let unlinked = 0;
    for (const event of source) {
      if (!["ai.response", "ai.finished", "ai.input"].includes(event.type)) continue;
      const group = linked.get(event.details?.localRequestId);
      if (!group) { unlinked++; continue; }
      group[event.type === "ai.response" ? "responses" : event.type === "ai.input" ? "inputs" : "finishes"].push(event);
    }
    return { groups, unlinked };
  }

  // Inspect bounded headers before asking the browser to decode an imported image.
  async function previewImage(blob, check) {
    if (!(blob instanceof Blob) || blob.size > 8 * MIB) throw new Error("Preview exceeds the report image limit.");
    const bytes = new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer());
    check();
    const view = new DataView(bytes.buffer);
    let w = 0, h = 0;
    if (blob.type === "image/png" && bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
      w = view.getUint32(16); h = view.getUint32(20);
    } else if (blob.type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
      let offset = 2;
      while (offset + 8 < bytes.length) {
        if (bytes[offset++] !== 255) break;
        while (bytes[offset] === 255) offset++;
        const marker = bytes[offset++];
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        if (offset + 2 > bytes.length) break;
        const length = view.getUint16(offset);
        if (length < 2 || offset + length > bytes.length) break;
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7) {
          h = view.getUint16(offset + 3); w = view.getUint16(offset + 5); break;
        }
        offset += length;
      }
    } else if (blob.type === "image/webp" && bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
      const kind = String.fromCharCode(...bytes.slice(12, 16));
      if (kind === "VP8X") {
        w = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
        h = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      } else if (kind === "VP8 " && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
        w = view.getUint16(26, true) & 16383; h = view.getUint16(28, true) & 16383;
      } else if (kind === "VP8L" && bytes[20] === 47) {
        const bits = view.getUint32(21, true); w = (bits & 16383) + 1; h = ((bits >>> 14) & 16383) + 1;
      }
    }
    if (!w || !h || w > 4096 || h > 4096 || w * h > 8 * MIB) throw new Error("Preview dimensions are unsupported.");
    const url = URL.createObjectURL(blob), img = new Image();
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { img.src = ""; reject(new Error("Preview could not be decoded in time.")); }, 8000);
        img.onload = () => { clearTimeout(timer); resolve(); };
        img.onerror = () => { clearTimeout(timer); reject(new Error("Preview could not be decoded.")); };
        img.src = url;
      });
      check();
      if (img.naturalWidth !== w || img.naturalHeight !== h) throw new Error("Preview dimensions do not match its header.");
      return img;
    } finally { URL.revokeObjectURL(url); }
  }

  async function makePdf(bundle, check, progress) {
    const canvas = document.createElement("canvas");
    canvas.width = 1190; canvas.height = 1684;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("PDF rendering is unavailable.");
    const pages = [];
    let y = 105, totalBytes = 0, textBytes = 0;
    function startPage() {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#536172"; ctx.font = "bold 18px sans-serif";
      ctx.fillText("TENET / SAVED WORK & AI HELP", 72, 55);
      y = 105;
    }
    async function finishPage() {
      check();
      if (pages.length >= 64) throw new Error("This report exceeds 64 pages. Share the complete .tenet file instead; no history was removed.");
      ctx.fillStyle = "#536172"; ctx.font = "18px sans-serif";
      ctx.fillText(`Client-recorded observations | Page ${pages.length + 1}`, 72, 1638);
      const blob = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("PDF page encoding timed out.")), 10000);
        canvas.toBlob(value => { clearTimeout(timer); value ? resolve(value) : reject(new Error("PDF page could not be encoded.")); }, "image/jpeg", 0.9);
      });
      check();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      check(); totalBytes += bytes.byteLength;
      if (totalBytes > 23 * MIB) throw new Error("This report exceeds the PDF sharing limit. Share the complete .tenet file instead.");
      pages.push(bytes); progress(`Preparing PDF: ${pages.length} page${pages.length === 1 ? "" : "s"}...`);
      await new Promise(resolve => setTimeout(resolve, 0));
      check(); startPage();
    }
    async function text(value, heading = false) {
      const content = typeof value === "string" ? value : "Not recorded";
      textBytes += encoder.encode(content).byteLength;
      if (textBytes > 2 * MIB) throw new Error("This report contains too much text for a PDF. Use the complete .tenet file.");
      const font = heading ? "bold 30px sans-serif" : "24px sans-serif";
      const height = heading ? 44 : 35;
      if (heading && y + height * 3 > 1580) await finishPage();
      for (const paragraph of content.replace(/\r/g, "").split("\n")) {
        const points = Array.from(paragraph);
        if (!points.length) { y += height; continue; }
        for (let from = 0; from < points.length;) {
          if (y + height > 1580) await finishPage();
          ctx.font = font; ctx.fillStyle = heading ? "#162638" : "#263547";
          let count = Math.min(96, points.length - from);
          while (count > 1 && ctx.measureText(points.slice(from, from + count).join("")).width > 1046) count--;
          if (from + count < points.length) {
            const lastSpace = points.slice(from, from + count).lastIndexOf(" ");
            if (lastSpace > count / 2) count = lastSpace + 1;
          }
          ctx.fillText(points.slice(from, from + count).join(""), 72, y);
          y += height; from += count;
        }
      }
      y += 13;
    }
    try {
      startPage();
      await text(bundle.title || bundle.attempt?.title || "Saved whiteboard", true);
      const savedAt = bundle.savedAt || bundle.attempt?.updatedAt;
      await text(`Saved (viewer local time): ${observedTime(savedAt)}`);
      await text("This report summarizes the selected saved version, not unsaved edits. Open its .tenet file in the Tenet teacher viewer for playback and recorded request images/JSON. PDF text is rendered as page images; use the viewer for selectable recorded text.");
      await text("History reflects observed application actions, not a screen recording or proof of authorship, independent work, or outside help. Client request inputs are not the complete downstream Gateway/provider prompt. This is not an LMS receipt.");
      if (!bundle.historyAvailable) await text("No recorded work history is available for this saved page.", true);
      if (bundle.incomplete || bundle.attempt?.incomplete || bundle.attempt?.status === "incomplete") await text("History is marked partial. Some actions or attachments were not retained.", true);
      let preview = bundle.finalPreview;
      if (!preview && bundle.finalPage?.asset && bundle.getAsset) {
        const ref = bundle.finalPage.asset;
        preview = await bundle.getAsset(bundle.attempt.id, ref.hash); check();
      }
      if (preview) {
        let img;
        try { img = await previewImage(preview, check); }
        catch (_error) { check(); await text("The saved preview could not be rendered within the PDF image limits. The work file retains its original data."); }
        if (img) {
          if (y > 1000) await finishPage();
          await text("Saved-page view", true);
          const scale = Math.min(1046 / img.naturalWidth, (1460 - y) / img.naturalHeight);
          ctx.drawImage(img, 72, y, img.naturalWidth * scale, img.naturalHeight * scale);
          y += img.naturalHeight * scale + 45;
          img.src = "";
          await text(bundle.finalPage?.caption || "Saved preview. This is not a reconstruction of missing history.");
        }
      } else await text("No saved-page preview was retained. The work file may still contain drawing data and recorded events.");
      const { groups, unlinked } = interactions(bundle.events);
      await text(`AI help: ${groups.length} recorded request${groups.length === 1 ? "" : "s"}`, true);
      if (unlinked) await text(`${unlinked} AI record(s) could not be uniquely linked to a request. Inspect the full history; this report does not guess their relationship.`);
      const methods = { "quick-help": "Quick help", "specific-question": "Typed question", "voice-question": "Talk to Tenet", automatic: "Automatic help" };
      for (let i = 0; i < groups.length; i++) {
        check();
        const group = groups[i], details = group.request.details || {};
        await text(`${i + 1}. ${methods[details.origin] || "Input method not recorded"}`, true);
        await text(`Observed (viewer local time): ${observedTime(group.request.timestamp || group.request.clientWallTime)}`);
        await text("Student question: " + (details.question || "No separate question text was recorded. Quick help may have used the submitted image/context."));
        if (details.questionTruncated) await text("The recorded question was truncated by the history limit.");
        if (!group.responses.length) await text("AI response: no response was retained.");
        for (const response of group.responses) {
          await text("AI response: " + (response.details?.text || "No text response was retained. Inspect the work file for recorded commands/attachments."));
          if (response.details?.textTruncated) await text("The recorded response was truncated by the history limit.");
        }
        await text("Outcome: " + (group.finishes.map(event => event.details?.outcome).filter(Boolean).join("; ") || "not recorded"));
        await text(group.inputs.length ? "Recorded client input details and retained images are available in the work file. Partial/omitted inputs are labeled there." : "Full client request inputs were not retained for this interaction.");
      }
      const gaps = (bundle.events || []).filter(event => /gap|limit|interrupted/i.test(event.type || ""));
      if (gaps.length) await text(`Coverage notice: ${gaps.length} recorded gap/limit/interruption event(s). Review the timeline for details.`);
      await finishPage(); check();
      const parts = [], offsets = [0];
      let length = 0;
      const append = value => { const data = typeof value === "string" ? encoder.encode(value) : value; parts.push(data); length += data.byteLength; };
      const object = (id, value) => { offsets[id] = length; append(`${id} 0 obj\n`); append(value); append("\nendobj\n"); };
      append("%PDF-1.4\n");
      object(1, "<< /Type /Catalog /Pages 2 0 R >>");
      object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`);
      for (let i = 0; i < pages.length; i++) {
        const id = 3 + i * 3, image = pages[i], content = "q 595 0 0 842 0 0 cm /PageImage Do Q\n";
        object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /PageImage ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
        offsets[id + 1] = length;
        append(`${id + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1190 /Height 1684 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.byteLength} >>\nstream\n`);
        append(image); append("\nendstream\nendobj\n");
        object(id + 2, `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}endstream`);
      }
      const xref = length;
      append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
      for (let i = 1; i < offsets.length; i++) append(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
      append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
      const result = new Blob(parts, { type: "application/pdf" });
      if (result.size > 24 * MIB) throw new Error("The report exceeds the PDF size limit.");
      return result;
    } finally { canvas.width = canvas.height = 0; }
  }

  function openReport(bundle, options = {}) {
    activeReport?.close();
    const dialog = document.createElement("dialog");
    dialog.className = "tenet-submission-report";
    dialog.setAttribute("aria-labelledby", "tenetSubmissionReportTitle");
    const heading = document.createElement("h2"); heading.id = "tenetSubmissionReportTitle"; heading.textContent = "PDF work report";
    const description = document.createElement("p");
    description.textContent = "Includes the saved-page preview and recorded AI questions, replies, and outcomes. The separate .tenet file keeps interactive playback and retained request inputs. Share only through your school-approved destination.";
    const status = document.createElement("p"); status.className = "tenet-submission-report-status"; status.setAttribute("role", "status");
    const actions = document.createElement("div"); actions.className = "tenet-submission-report-actions";
    const prepare = document.createElement("button"); prepare.type = "button"; prepare.textContent = "Prepare PDF";
    const close = document.createElement("button"); close.type = "button"; close.textContent = "Close";
    actions.append(prepare, close); dialog.append(heading, description, status, actions);
    document.body.append(dialog);
    let current = true, pdf = null;
    const check = () => { if (!current || (options.isCurrent && !options.isCurrent())) throw abortError(); };
    const cleanup = () => {
      if (!current) return;
      current = false; pdf = null; dialog.remove();
      window.TenetInk?.resume?.("submission-report");
      if (activeReport === dialog) activeReport = null;
    };
    dialog.addEventListener("close", cleanup, { once: true });
    close.addEventListener("click", () => dialog.close());
    prepare.addEventListener("click", async () => {
      prepare.disabled = true;
      try {
        check();
        if (!pdf) {
          status.textContent = "Preparing locally...";
          pdf = await makePdf(bundle, check, message => { if (current) status.textContent = message; });
          check(); prepare.textContent = "Share / save PDF";
          status.textContent = `PDF ready (${(pdf.size / MIB).toFixed(2)} MiB). Nothing has been uploaded.`;
        } else {
          const result = await shareFile(pdf, filenameFor(bundle.title || bundle.attempt?.title, ".pdf"), { isCurrent: () => current && (!options.isCurrent || options.isCurrent()) });
          if (current) status.textContent = result?.cancelled ? "Sharing cancelled. The PDF is ready to try again." : "PDF handed to sharing/download. Confirm it was saved or attached in your destination.";
        }
      } catch (error) { if (current) status.textContent = error?.message || "The PDF could not be prepared."; }
      finally { if (current) prepare.disabled = false; }
    });
    try {
      check(); window.TenetInk?.suspend?.("submission-report");
      dialog.showModal(); activeReport = dialog;
    } catch (error) { cleanup(); throw error; }
  }

  window.addEventListener("pagehide", () => {
    activeReport?.close();
    for (const url of downloads) URL.revokeObjectURL(url);
    downloads.clear();
  });
  window.TenetSubmissionShare = shareFile;
  window.TenetSubmissionReport = openReport;
})();
