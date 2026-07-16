// ======================================================================
// Export: PNG (single card) and combined PDF (cover + cards + matrix).
// Cards are rendered off-screen at a fixed 1100px width for consistency.
// ======================================================================
const Exporter = (() => {
  const A4 = { w: 297, h: 210 }; // landscape, mm
  const MARGIN = 10;

  function stage(html) {
    const el = document.createElement("div");
    el.className = "export-stage";
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }

  async function nodeToPng(node) {
    // skipFonts: system font stack, no @font-face to embed (avoids CSS fetches)
    const opts = { pixelRatio: 2, backgroundColor: "#ffffff", skipFonts: true };
    // double render works around fonts/images not ready on first pass
    await htmlToImage.toPng(node, opts);
    return htmlToImage.toPng(node, opts);
  }

  // For PDF pages: JPEG at lower pixel ratio — many pages of full-res PNG can
  // exceed the JS string limit ("Invalid string length") when jsPDF assembles
  // the document. JPEG keeps each page ~5-10x smaller at equal readability.
  async function nodeToJpeg(node) {
    const opts = { pixelRatio: 1.5, backgroundColor: "#ffffff", skipFonts: true, quality: 0.9 };
    await htmlToImage.toJpeg(node, opts);
    return htmlToImage.toJpeg(node, opts);
  }

  function download(dataUrl, filename) {
    const a = document.createElement("a");
    a.href = dataUrl; a.download = filename; a.click();
  }

  const safe = (s) => s.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60);

  async function loadImg(src) {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    return img;
  }

  async function policyPng(p, tenantName, logo) {
    const st = stage(Render.card(p, tenantName, { export: true, logo }));
    try {
      const url = await nodeToPng(st.firstElementChild);
      download(url, `${p.seq}-${safe(p.name)}.png`);
    } finally { st.remove(); }
  }

  // Neutral cover: no Limon-IT branding; tenant branding logo when available.
  async function addCover(pdf, tenantName, count, logo) {
    pdf.setFillColor(31, 41, 51);
    pdf.rect(0, 0, A4.w, A4.h, "F");
    pdf.setFillColor(50, 63, 75);
    pdf.rect(0, A4.h - 40, A4.w, 40, "F");
    if (logo) {
      try {
        const img = await loadImg(logo);
        const w = 55, h = w * img.height / img.width;
        pdf.addImage(logo, "PNG", MARGIN, 26, w, Math.min(h, 28));
      } catch {}
    }
    pdf.setDrawColor(129, 156, 178); pdf.setLineWidth(1);
    pdf.line(MARGIN, 96, 110, 96);
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(30); pdf.setFont("helvetica", "bold");
    pdf.text("Conditional Access", MARGIN, 70);
    pdf.text("Documentation", MARGIN, 84);
    pdf.setFontSize(13); pdf.setFont("helvetica", "normal");
    pdf.setTextColor(200, 209, 217);
    pdf.text(`${tenantName || "Tenant"}  ·  ${count} policies  ·  ${new Date().toISOString().slice(0, 10)}`, MARGIN, 110);
    pdf.setFontSize(10);
    pdf.text(`Generated ${new Date().toISOString().slice(0, 10)}`, MARGIN, A4.h - 18);
  }

  async function addImagePaged(pdf, node) {
    // renders node and adds it, slicing vertically over multiple pages if needed
    const url = await nodeToJpeg(node);
    const img = await loadImg(url);
    if (!img.width || !img.height) throw new Error("rendered image is empty");
    const availW = A4.w - MARGIN * 2, availH = A4.h - MARGIN * 2;
    const scale = availW / img.width;
    const totalH = img.height * scale;
    if (totalH <= availH) {
      pdf.addImage(url, "JPEG", MARGIN, MARGIN, availW, totalH);
      return;
    }
    // slice
    const sliceHpx = availH / scale;
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    const ctx = canvas.getContext("2d");
    let y = 0, first = true;
    while (y < img.height) {
      const h = Math.ceil(Math.min(sliceHpx, img.height - y));
      canvas.height = h;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, h);
      ctx.drawImage(img, 0, y, img.width, h, 0, 0, img.width, h);
      if (!first) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", MARGIN, MARGIN, availW, h * scale);
      y += h; first = false;
    }
  }

  async function policiesPdf(policies, tenantName, includeMatrix, onProgress, logo) {
    const pdf = new jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    await addCover(pdf, tenantName, policies.length, logo);

    const failed = [];
    for (let i = 0; i < policies.length; i++) {
      onProgress?.(`Rendering ${policies[i].seq} (${i + 1}/${policies.length})…`);
      const st = stage(Render.card(policies[i], tenantName, { export: true, logo }));
      try {
        pdf.addPage();
        await addImagePaged(pdf, st.firstElementChild);
        pdf.setFontSize(8); pdf.setTextColor(120, 130, 140);
        pdf.text(`${policies[i].seq} — ${policies[i].name}`.slice(0, 120), MARGIN, A4.h - 4);
      } catch (e) {
        // keep going: note the failure on the page instead of aborting the whole PDF
        console.error(`PDF: rendering ${policies[i].seq} failed`, e);
        failed.push(policies[i].seq);
        pdf.setFontSize(12); pdf.setTextColor(176, 74, 58);
        pdf.text(`${policies[i].seq} — ${policies[i].name}\n\nCould not render this policy card (${e.message || e}).`, MARGIN, 30);
      } finally { st.remove(); }
    }
    if (failed.length === policies.length) throw new Error("all policy cards failed to render: " + (failed.join(", ")));

    if (includeMatrix) {
      onProgress?.("Rendering settings matrix…");
      const st = stage(`<div class="matrix-wrap" style="width:2000px"><table class="matrix">${Render.matrix(policies, { full: true })}</table></div>`);
      st.style.width = "2000px";
      try {
        pdf.addPage();
        await addImagePaged(pdf, st.firstElementChild);
      } catch (e) { console.error("PDF: matrix appendix failed", e); }
      finally { st.remove(); }
    }
    if (failed.length) onProgress?.(`Done with ${failed.length} card(s) skipped: ${failed.join(", ")}`);

    pdf.save(`ConditionalAccess-${safe(tenantName || "tenant")}-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  return { policyPng, policiesPdf };
})();
