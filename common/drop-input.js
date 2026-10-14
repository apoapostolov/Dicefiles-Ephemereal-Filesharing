"use strict";

// DataTransfer is readable only during the drop event. Capture files/entries
// before awaiting initialization or starting asynchronous directory traversal.
function collectDroppedFiles(data) {
  const files = []; const entries = [];
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== "file") {
      continue;
    }
    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    if (entry) {
      entries.push(entry);
    }
    else {
      const file = item.getAsFile?.();
      if (file) {
        files.push(file);
      }
    }
  }
  if (!entries.length && !files.length) {
    files.push(...Array.from(data.files || []));
  }
  return { files, entries };
}

module.exports = { collectDroppedFiles };
