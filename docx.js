/* docx.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 11E0. BRANDED LETTERHEAD (Wave 4) ============================================================
     * Shared agency letterhead + "LAW ENFORCEMENT SENSITIVE" banner applied to
     * every PDF (pdfLetterhead) and .docx (brandParas, prepended in downloadDocx).
     * logoDataUrl is the image slot: set it to a PNG/JPEG data URL once a seal is
     * supplied — PDF renders it via addImage; DOCX image embedding is a future step
     * (text letterhead ships now). */
    const LETTERHEAD = {
      agency: 'Criminal Investigation Division',
      jurisdiction: 'State of San Andreas',
      banner: 'LAW ENFORCEMENT SENSITIVE',
      logoDataUrl: '',   // ← drop a data: URL here when a logo/seal is provided
    };
    function brandParas() {
      return [
        { text: LETTERHEAD.agency.toUpperCase(), style: 'letterhead' },
        { text: LETTERHEAD.jurisdiction, style: 'subtitle' },
        { text: '— ' + LETTERHEAD.banner + ' —', style: 'banner' },
      ];
    }
    // Draws the letterhead at the top of a jsPDF doc; returns the y to start the body at.
    function pdfLetterhead(doc, M) {
      const pw = doc.internal.pageSize.getWidth(); let y = M;
      if (LETTERHEAD.logoDataUrl) { try { doc.addImage(LETTERHEAD.logoDataUrl, 'PNG', pw / 2 - 22, y, 44, 44); y += 50; } catch (e) {} }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
      doc.text(LETTERHEAD.agency.toUpperCase(), pw / 2, y, { align: 'center' }); y += 15;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
      doc.text(LETTERHEAD.jurisdiction, pw / 2, y, { align: 'center' }); y += 13;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(185, 28, 28);
      doc.text('— ' + LETTERHEAD.banner + ' —', pw / 2, y, { align: 'center' }); y += 10;
      doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.5); doc.line(M, y, pw - M, y); y += 16;
      doc.setTextColor(0, 0, 0);   // reset for body
      return y;
    }

    /* ============================================================ 11E. OOXML .docx WRITER (dependency-free) ============================================================ */
    function crc32(buf) { let crc = ~0; for (let i=0;i<buf.length;i++){ crc ^= buf[i]; for (let j=0;j<8;j++) crc = (crc>>>1) ^ (0xEDB88320 & -(crc & 1)); } return ~crc >>> 0; }
    function zipStore(files) {
      const enc = new TextEncoder(); const chunks = []; const central = []; let offset = 0;
      files.forEach((f) => {
        const nameB = enc.encode(f.name); const data = f.data; const crc = crc32(data);
        const lh = new Uint8Array(30 + nameB.length); const dv = new DataView(lh.buffer);
        dv.setUint32(0,0x04034b50,true); dv.setUint16(4,20,true); dv.setUint16(6,0,true); dv.setUint16(8,0,true); dv.setUint16(10,0,true); dv.setUint16(12,0,true);
        dv.setUint32(14,crc,true); dv.setUint32(18,data.length,true); dv.setUint32(22,data.length,true); dv.setUint16(26,nameB.length,true); dv.setUint16(28,0,true);
        lh.set(nameB,30); chunks.push(lh, data);
        const ch = new Uint8Array(46 + nameB.length); const cv = new DataView(ch.buffer);
        cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(8,0,true); cv.setUint16(10,0,true); cv.setUint16(12,0,true); cv.setUint16(14,0,true);
        cv.setUint32(16,crc,true); cv.setUint32(20,data.length,true); cv.setUint32(24,data.length,true); cv.setUint16(28,nameB.length,true);
        cv.setUint16(30,0,true); cv.setUint16(32,0,true); cv.setUint16(34,0,true); cv.setUint16(36,0,true); cv.setUint32(38,0,true); cv.setUint32(42,offset,true);
        ch.set(nameB,46); central.push(ch); offset += lh.length + data.length;
      });
      let cdSize = 0; central.forEach((c) => cdSize += c.length); const cdOffset = offset; central.forEach((c) => chunks.push(c));
      const end = new Uint8Array(22); const ev = new DataView(end.buffer);
      ev.setUint32(0,0x06054b50,true); ev.setUint16(4,0,true); ev.setUint16(6,0,true); ev.setUint16(8,files.length,true); ev.setUint16(10,files.length,true); ev.setUint32(12,cdSize,true); ev.setUint32(16,cdOffset,true); ev.setUint16(20,0,true);
      chunks.push(end);
      return new Blob(chunks, { type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    }
    const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[c]));
    function paraXml(p) {
      const styles = { title:{sz:36,b:1,jc:'center'}, subtitle:{sz:18,b:0,jc:'center',color:'64748B'}, heading:{sz:26,b:1}, normal:{sz:22,b:0}, letterhead:{sz:28,b:1,jc:'center'}, banner:{sz:18,b:1,jc:'center',color:'B91C1C'} };
      const s = styles[p.style] || styles.normal;
      const rpr = `<w:rPr>${s.b?'<w:b/>':''}<w:sz w:val="${s.sz}"/>${s.color?`<w:color w:val="${s.color}"/>`:''}</w:rPr>`;
      const ppr = `<w:pPr>${s.jc?`<w:jc w:val="${s.jc}"/>`:''}<w:spacing w:after="120"/></w:pPr>`;
      return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(p.text)}</w:t></w:r></w:p>`;
    }
    function downloadDocx(title, paras, filename) {
      const enc = new TextEncoder();
      const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
      const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
      const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${brandParas().concat(paras).map(paraXml).join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
      const blob = zipStore([
        { name:'[Content_Types].xml', data: enc.encode(contentTypes) },
        { name:'_rels/.rels', data: enc.encode(rels) },
        { name:'word/document.xml', data: enc.encode(doc) },
      ]);
      const a = document.createElement('a'); const url = URL.createObjectURL(blob);
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

