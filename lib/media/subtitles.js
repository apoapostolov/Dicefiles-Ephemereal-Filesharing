"use strict";

const MAX_SUBTITLE_BYTES = 256 * 1024;

function normalizeSubtitle(text, language, filename) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_SUBTITLE_BYTES || !text.trim() || text.includes("\u0000") || text.includes("\uFFFD")) {
    throw new Error("Use a UTF-8 subtitle file smaller than 256 KiB.");
  }
  let lang;
  try {
    [lang] = Intl.getCanonicalLocales(language);
  }
  catch (_) { /* A useful validation message follows. */ }
  if (!lang || lang.length > 35) {
    throw new Error("Enter a subtitle language code, such as en, uk or pt-BR.");
  }
  const input = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!/^WEBVTT(?:\s|$)/.test(input) && !/\d{2}:\d{2}:\d{2},\d{3}\s+-->/.test(input)) {
    throw new Error("Use a WebVTT or SubRip subtitle file. Convert other formats to VTT or SRT first.");
  }
  const body = input.replace(/^WEBVTT[^\n]*\n?/, "").trim();
  const cues = [];
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const timing = lines.findIndex(line => line.includes("-->"));
    if (timing < 0) {
      continue;
    }
    const match = lines[timing].match(/^((?:\d{2,3}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2,3}:)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$/);
    const seconds = value => {
      const parts = value.replace(",", ".").split(":").map(Number);
      return parts.slice(-2).some(part => part >= 60) ? Infinity : parts.reduce((total, part) => total * 60 + part, 0);
    };
    if (!match || seconds(match[2]) <= seconds(match[1]) || seconds(match[2]) > 86400) {
      throw new Error("A subtitle cue has an invalid time. Correct its start and end times, then upload again.");
    }
    // Keep only plain cue text: no STYLE, REGION, script, markup or cue settings.
    const caption = lines.slice(timing + 1).join("\n").replace(/<[^>]*>/g, "").replace(/-->/g, "→").slice(0, 4000);
    if (caption.trim()) {
      cues.push(`${match[1].replace(",", ".")} --> ${match[2].replace(",", ".")}\n${caption}`);
    }
    if (cues.length > 10000) {
      throw new Error("This subtitle has too many cues. Split it into smaller subtitle files.");
    }
  }
  if (!cues.length) {
    throw new Error("No subtitle cues were found. Check the file or export it again as VTT or SRT.");
  }
  // eslint-disable-next-line no-control-regex -- Remove control characters from untrusted display filenames.
  const name = typeof filename === "string" ? filename.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 255) : "";
  return { text: `WEBVTT\n\n${cues.join("\n\n")}\n`, language: lang, label: new Intl.DisplayNames(["en"], { type: "language" }).of(lang) || lang, cues: cues.length, ...(name ? { filename: name } : {}) };
}

module.exports = { normalizeSubtitle, MAX_SUBTITLE_BYTES };
