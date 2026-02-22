"use strict";

/**
 * Unit tests for lib/markdown.js — renderMarkdown.
 * All pure string transformations.
 */

const { renderMarkdown } = require("../../lib/markdown.js");

describe("renderMarkdown", () => {
  // ── empty / trivial ───────────────────────────────────────────────────────
  test("empty string returns empty string", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(null)).toBe("");
    expect(renderMarkdown(undefined)).toBe("");
  });

  test("whitespace-only string returns empty", () => {
    expect(renderMarkdown("   ")).toBe("");
  });

  // ── paragraph wrapping ────────────────────────────────────────────────────
  test("plain text is wrapped in <p>", () => {
    const html = renderMarkdown("Hello world");
    expect(html).toBe("<p>Hello world</p>");
  });

  test("two paragraphs produce two <p> tags", () => {
    const html = renderMarkdown("First\n\nSecond");
    const matches = html.match(/<p>/g) || [];
    expect(matches).toHaveLength(2);
    expect(html).toContain("First");
    expect(html).toContain("Second");
  });

  test("single newline within paragraph becomes <br>", () => {
    const html = renderMarkdown("line1\nline2");
    expect(html).toContain("<br>");
  });

  // ── inline formatting ──────────────────────────────────────────────────────
  test("bold **text** renders <strong>", () => {
    const html = renderMarkdown("**bold**");
    expect(html).toContain("<strong>bold</strong>");
  });

  test("italic *text* renders <em>", () => {
    const html = renderMarkdown("*italic*");
    expect(html).toContain("<em>italic</em>");
  });

  test("inline code `code` renders <code>", () => {
    const html = renderMarkdown("`code snippet`");
    expect(html).toContain("<code>code snippet</code>");
  });

  test("markdown link renders <a> with correct href", () => {
    const html = renderMarkdown("[Visit](https://example.com)");
    expect(html).toContain('href="https://example.com'); // normalized URL (may gain trailing /)
    expect(html).toContain("Visit");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  // ── XSS escaping ──────────────────────────────────────────────────────────
  test("<script> tag is escaped", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("& is escaped", () => {
    const html = renderMarkdown("a & b");
    expect(html).toContain("&amp;");
  });

  test('" is escaped', () => {
    const html = renderMarkdown('say "hello"');
    expect(html).toContain("&quot;");
  });

  test("' is escaped", () => {
    const html = renderMarkdown("it's fine");
    expect(html).toContain("&#39;");
  });

  // ── security: javascript: link is rejected ────────────────────────────────
  test("javascript: URL in link is not rendered as <a>", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    // Either the link is not rendered or the href is safe
    expect(html).not.toContain('href="javascript:');
  });

  // ── non-http scheme in link is rejected ───────────────────────────────────
  test("ftp: URL in link is not rendered as <a>", () => {
    const html = renderMarkdown("[files](ftp://example.com)");
    expect(html).not.toContain('href="ftp:');
  });

  // ── combined formatting ────────────────────────────────────────────────────
  test("bold inside paragraph", () => {
    const html = renderMarkdown("Plain **bold** end");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("Plain");
    expect(html).toContain("end");
  });

  // ── return type ───────────────────────────────────────────────────────────
  test("always returns a string", () => {
    expect(typeof renderMarkdown("test")).toBe("string");
    expect(typeof renderMarkdown(null)).toBe("string");
  });
});
