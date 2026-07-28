"use strict";
/* eslint-env jest */

const {
  classifyDetectedType,
} = require("../../lib/media/pipeline");

describe("media metadata fallback classification", () => {
  test.each([
    ["photo.png", "image/png", "image", "image/png", "PNG"],
    ["book.pdf", "application/pdf", "document", "application/pdf", "PDF"],
    ["bundle.zip", "application/zip", "archive", "application/zip", "ZIP"],
    ["comic.cbz", "application/zip", "document", "application/octet-stream", "CBZ"],
    ["clip.mp4", "video/mp4", "video", "video/mp4", "MP4"],
  ])(
    "classifies %s without ExifTool",
    (name, detectedMime, type, mime, metaType) => {
      expect(classifyDetectedType(name, detectedMime)).toEqual({
        type,
        mime,
        metaType,
      });
    },
  );
});
