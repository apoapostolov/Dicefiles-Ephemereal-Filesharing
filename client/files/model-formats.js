"use strict";

const MODEL_EXTENSIONS = new Set([
  ".stl", ".3mf", ".obj", ".gltf", ".glb", ".ply", ".fbx",
  ".usd", ".usda", ".usdc", ".usdz", ".splat", ".spz",
]);

export function isSupportedModelName(name) {
  const match = String(name || "").toLowerCase().match(/\.[a-z0-9]{1,8}$/);
  return !!match && MODEL_EXTENSIONS.has(match[0]);
}
