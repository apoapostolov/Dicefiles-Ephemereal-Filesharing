"use strict";

const ESCAPE = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
});

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, c => ESCAPE[c] || c);
}

function safeHref(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  }
  catch (ex) {
    return null;
  }
}

function renderInline(md) {
  let html = escapeHtml(md);

  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi,
    (_, text, url) => {
      const href = safeHref(url);
      if (!href) {
        return `[${text}](${url})`;
      }
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return html;
}

function renderMarkdown(md) {
  const src = (md || "").toString().trim();
  if (!src) {
    return "";
  }

  const paragraphs = src.split(/\n{2,}/g);
  const body = paragraphs.map(p => {
    const inline = renderInline(p).replace(/\n/g, "<br>");
    return `<p>${inline}</p>`;
  });
  return body.join("");
}

module.exports = {
  renderMarkdown,
};
