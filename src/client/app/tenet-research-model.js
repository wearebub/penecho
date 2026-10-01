(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.TenetResearchModel = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const LIMITS = { title: 120, text: 4000, source: 300, url: 2048 };
  const COLORS = {
    fact: ['#fff3bf', '#957100'],
    thought: ['#dfedff', '#3567a8'],
    source: ['#e3f3e5', '#327a43'],
    frame: ['#f1f5f9', '#64748b']
  };
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

  // Limits count UTF-16 code units. Reject oversize input; never shorten prose.
  function normalize(value) {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const { version, kind, title, text, source, url } = value;
      if (version !== 1 || !['fact', 'thought', 'source', 'frame'].includes(kind)) return null;
      const fields = { title, text, source, url };
      for (const key of Object.keys(LIMITS)) {
        if (typeof fields[key] !== 'string' || fields[key].length > LIMITS[key]) return null;
      }
      if (!title.trim() && !text.trim()) return null;
      // Check before trimming or URL parsing, both of which can hide controls.
      if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(url)
          || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(url)) return null;
      const link = url.trim();
      if (link) {
        if (!/^https?:\/\//i.test(link) || /\\/.test(link) || /^https?:\/\/[^/?#]*@/i.test(link)) return null;
        const parsed = new URL(link);
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname
            || parsed.username || parsed.password) return null;
      }
      return { version: 1, kind, title, text, source, url: link };
    } catch (_) {
      return null;
    }
  }

  function template(id, title, description, frames) {
    return Object.freeze({ id, title, description,
      frames: Object.freeze(frames.map(([title, text]) => Object.freeze({ title, text }))) });
  }
  const TEMPLATES = Object.freeze([
    template('research', 'Research organizer', 'Group research into three subtopics, with evidence and sources.', [
      ['Subtopic 1', 'What do you want to learn? Add facts, questions, and sources for this subtopic.'],
      ['Subtopic 2', 'Gather related facts. Explain their meaning and keep each source with its evidence.'],
      ['Subtopic 3', 'Explore another part of the topic. Note connections and questions to investigate.']
    ]),
    template('informative', 'Informative writing', 'Plan an introduction, three body sections, and a conclusion.', [
      ['Introduction', 'Hook your reader, introduce the topic, and state your central idea.'],
      ['Body 1', 'Develop your first supporting idea with facts, explanation, and sources.'],
      ['Body 2', 'Develop your second supporting idea with facts, explanation, and sources.'],
      ['Body 3', 'Develop your third supporting idea with facts, explanation, and sources.'],
      ['Conclusion', 'Return to the central idea, connect your key points, and leave a final insight.']
    ]),
    template('cause-effect', 'Cause and effect', 'Connect an event with its causes and effects using evidence.', [
      ['Causes', 'What contributed to the event? Separate supported causes from possibilities.'],
      ['Event or change', 'Describe what happened, when, and where. Record your sources.'],
      ['Effects', 'What changed as a result? Support each connection with evidence.']
    ]),
    template('compare-contrast', 'Compare and contrast', 'Compare two subjects using the same criteria.', [
      ['Subject A', 'Record features unique to the first subject, with evidence and sources.'],
      ['Both subjects', 'What do the subjects share? Compare them using the same criteria.'],
      ['Subject B', 'Record features unique to the second subject, with evidence and sources.']
    ])
  ]);

  function inkWidth(ctx, text) {
    const m = ctx.measureText(text);
    return Math.max(0, m.actualBoundingBoxLeft || 0) + Math.max(m.width, m.actualBoundingBoxRight || 0);
  }

  // Keep whitespace and hard breaks; split oversized words at grapheme boundaries.
  function wrap(ctx, text, width) {
    const lines = [];
    for (const paragraph of text.split(/\r\n?|\n|\u2028|\u2029/u)) {
      let line = '';
      for (const token of paragraph.match(/\s+|\S+/gu) || []) {
        if (inkWidth(ctx, line + token) <= width) { line += token; continue; }
        if (line) lines.push(line);
        line = '';
        const units = segmenter ? Array.from(segmenter.segment(token), item => item.segment) : Array.from(token);
        for (const unit of units) {
          if (inkWidth(ctx, unit) > width) throw new RangeError('A text glyph cannot fit the research canvas.');
          if (line && inkWidth(ctx, line + unit) > width) { lines.push(line); line = ''; }
          line += unit;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  function render(value) {
    const note = normalize(value);
    if (!note) throw new TypeError('Invalid research note.');
    if (typeof document === 'undefined') throw new Error('Canvas rendering requires a document.');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('A 2D canvas context is required.');
    const frame = note.kind === 'frame';
    const width = frame ? 1100 : 600;
    const maxHeight = frame ? 800 : 1800;
    const pad = 32;
    const rows = [];
    let y = pad;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';

    function add(text, size, weight, gap) {
      const font = `${weight} ${size}px ${weight === 700 && size === 30 ? 'Georgia, serif' : '"Trebuchet MS", sans-serif'}`;
      ctx.font = font;
      for (const line of wrap(ctx, text, width - pad * 2)) {
        const m = ctx.measureText(line);
        const ascent = Math.max(size, m.actualBoundingBoxAscent || 0);
        const descent = Math.max(size * 0.25, m.actualBoundingBoxDescent || 0);
        const height = Math.ceil(Math.max(size * 1.45, ascent + descent + 6));
        rows.push({ text: line, font, x: pad + Math.max(0, m.actualBoundingBoxLeft || 0), y: y + ascent });
        y += height;
        if (y + pad > maxHeight) throw new RangeError('Research text cannot fit without clipping; split it into smaller notes.');
      }
      y += gap;
    }

    add(note.kind.toUpperCase(), 14, 700, 8);
    if (note.title) add(note.title, 30, 700, 18);
    const bandBottom = y;
    if (note.text) add(note.text, 22, 400, 18);
    if (note.source || note.url) {
      add('SOURCE / PROVENANCE', 14, 700, 8);
      if (note.source) add(note.source, 20, 400, 8);
      if (note.url) add(note.url, 20, 400, 0);
    }
    const needed = Math.ceil(y + pad);
    if (needed > maxHeight) throw new RangeError('Research text cannot fit without clipping; split it into smaller notes.');
    canvas.width = width;
    canvas.height = frame ? 800 : Math.max(320, needed);
    // Resizing clears context state. Paint only after the full layout fits.
    ctx.fillStyle = COLORS[note.kind][0];
    if (frame) ctx.fillRect(2, 2, width - 4, bandBottom - 2);
    else ctx.fillRect(0, 0, width, canvas.height);
    ctx.strokeStyle = COLORS[note.kind][1];
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, canvas.height - 2);
    ctx.fillStyle = '#172b34';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    for (const row of rows) {
      ctx.font = row.font;
      ctx.fillText(row.text, row.x, row.y);
    }
    return canvas;
  }

  return Object.freeze({ normalize, render, TEMPLATES,
    templates: () => TEMPLATES.map(item => ({ ...item, frames: item.frames.map(frame => ({ ...frame })) })) });
});
