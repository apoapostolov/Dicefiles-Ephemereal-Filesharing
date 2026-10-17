"use strict";

import Modal from "../modal";
import { dom } from "../util";
const MAX_MODEL_BYTES = 256 * 1024 * 1024;
const MAX_MODEL_ZIP_ENTRIES = 10_000;
const MAX_MODEL_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_MODEL_ASSETS = 64;

function extensionOf(name) {
  const match = String(name || "").toLowerCase().match(/\.[a-z0-9]{1,8}$/);
  return match ? match[0] : "";
}

function modelMime(name) {
  const extension = extensionOf(name);
  if ([".gltf", ".usda"].includes(extension)) {
    return "model/gltf+json";
  }
  if ([".glb", ".usdz"].includes(extension)) {
    return "model/gltf-binary";
  }
  if (extension === ".obj") {
    return "text/plain";
  }
  return "application/octet-stream";
}

function archiveApiUrl(key, path) {
  return `/api/v1/archive/${encodeURIComponent(key)}/file?path=${encodeURIComponent(path)}&preview=3d`;
}

function entryPath(basePath, reference) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(reference || "").split(/[?#]/, 1)[0]);
  }
  catch {
    throw new Error("The model contains an invalid asset path.");
  }
  if (!decoded || /^(?:[a-z]+:|\/|\\)/i.test(decoded) || decoded.includes("\\")) {
    throw new Error("The model refers to a file outside its ZIP folder.");
  }
  const parts = basePath.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (!parts.length) {
        throw new Error("The model refers to a file outside its ZIP folder.");
      }
      parts.pop();
    }
    else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function isExternalUri(uri) {
  return /^(?:data:|blob:|https?:|file:)/i.test(String(uri || ""));
}

function readGltfJson(bytes, extension) {
  if (extension !== ".glb") {
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const view = new DataView(bytes);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) {
    throw new Error("This GLB file has an invalid header.");
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > bytes.byteLength) {
    throw new Error("This GLB file is missing its model description.");
  }
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).replace(/\s+$/g, ""));
}

function rewriteGlbJson(bytes, data) {
  const view = new DataView(bytes);
  const previousJsonLength = view.getUint32(12, true);
  const trailingChunks = bytes.subarray(20 + previousJsonLength);
  const json = new TextEncoder().encode(JSON.stringify(data));
  const jsonLength = Math.ceil(json.byteLength / 4) * 4;
  const output = new Uint8Array(20 + jsonLength + trailingChunks.byteLength);
  const outputView = new DataView(output.buffer);
  outputView.setUint32(0, 0x46546c67, true);
  outputView.setUint32(4, 2, true);
  outputView.setUint32(8, output.byteLength, true);
  outputView.setUint32(12, jsonLength, true);
  outputView.setUint32(16, 0x4e4f534a, true);
  output.set(json, 20);
  output.fill(0x20, 20 + json.byteLength, 20 + jsonLength);
  output.set(trailingChunks, 20 + jsonLength);
  return output;
}

function parseGltfReferences(bytes, extension = ".gltf") {
  let data;
  try {
    data = readGltfJson(bytes, extension);
  }
  catch {
    throw new Error("This glTF file is invalid or could not be read.");
  }
  const refs = [
    ...(Array.isArray(data.buffers) ? data.buffers : []),
    ...(Array.isArray(data.images) ? data.images : []),
  ].map(item => item && item.uri).filter(uri => uri && !isExternalUri(uri));
  const externalRefs = [
    ...(Array.isArray(data.buffers) ? data.buffers : []),
    ...(Array.isArray(data.images) ? data.images : []),
  ].map(item => item && item.uri).filter(uri => /^https?:|^file:/i.test(String(uri || "")));
  return { data, refs, externalRefs };
}

function parseObjReferences(bytes) {
  const text = new TextDecoder().decode(bytes);
  const refs = text.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*mtllib\s+(.+?)\s*$/i);
    return match ? match[1].trim().split(/\s+/) : [];
  });
  return { text, refs };
}

function parseMtlTextureReferences(text) {
  const directive = /^\s*(?:map_[a-z0-9_]+|bump|map_bump|disp|decal|refl)\s+(.+?)\s*$/i;
  const refs = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(directive);
    if (match) {
      const value = match[1].trim().replace(/^"|"$/g, "");
      refs.push(value.split(/\s+/).pop());
    }
  }
  return refs;
}

function elementChildren(parent, localName) {
  return Array.from(parent?.children || []).filter(element => element.localName === localName);
}

function parse3mfTransform(value) {
  const values = String(value || "").trim().split(/\s+/).map(Number);
  if (values.length !== 12 || values.some(number => !Number.isFinite(number))) {
    return point => point;
  }
  return ([x, y, z]) => [
    values[0] * x + values[1] * y + values[2] * z + values[9],
    values[3] * x + values[4] * y + values[5] * z + values[10],
    values[6] * x + values[7] * y + values[8] * z + values[11],
  ];
}

function parse3mfColor(value) {
  const hex = String(value || "").replace(/^#/, "");
  if (!/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) {
    return [0.68, 0.68, 0.68, 1];
  }
  const channels = hex.match(/.{2}/g).map(channel => parseInt(channel, 16) / 255);
  if (channels.length === 3) {
    channels.push(1);
  }
  return channels;
}

async function load3mf(viewerElement, bytes, cacheAsset) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  if (entries.length > MAX_MODEL_ZIP_ENTRIES) {
    throw new Error("This 3MF package contains too many files to preview safely.");
  }
  const unpackedBytes = entries.reduce((total, entry) =>
    total + (Number(entry._data?.uncompressedSize) || 0), 0);
  if (unpackedBytes > MAX_MODEL_ZIP_UNCOMPRESSED_BYTES) {
    throw new Error("This 3MF package expands beyond the 512 MB preview limit.");
  }
  const modelEntry = entries.find(entry => /^3d\/3dmodel\.model$/i.test(entry.name)) ||
    entries.find(entry => /^3d\/.*\.model$/i.test(entry.name));
  if (!modelEntry) {
    throw new Error("This 3MF package does not contain a readable 3D model.");
  }
  const xml = new DOMParser().parseFromString(await modelEntry.async("string"), "application/xml");
  if (xml.querySelector("parsererror")) {
    throw new Error("The 3MF model description is malformed.");
  }
  const root = xml.documentElement;
  const resources = elementChildren(root, "resources")[0];
  const build = elementChildren(root, "build")[0];
  if (!resources || !build) {
    throw new Error("The 3MF package is missing its model or build data.");
  }

  const objects = new Map(elementChildren(resources, "object").map(object => [object.getAttribute("id"), object]));
  const propertyGroups = new Map();
  for (const group of elementChildren(resources, "basematerials").concat(elementChildren(resources, "colorgroup"))) {
    const childName = group.localName === "basematerials" ? "base" : "color";
    const colors = elementChildren(group, childName).map(item => parse3mfColor(item.getAttribute("displaycolor")));
    propertyGroups.set(group.getAttribute("id"), { kind: "color", colors });
  }
  const textures = new Map();
  const textureDefinitions = elementChildren(resources, "texture2d");
  if (textureDefinitions.length > MAX_MODEL_ASSETS) {
    throw new Error("This 3MF package links to too many textures to preview safely.");
  }
  for (const texture of textureDefinitions) {
    let path;
    try {
      path = decodeURIComponent(String(texture.getAttribute("path") || "")).replace(/^\/+/, "");
    }
    catch {
      throw new Error("This 3MF package contains an invalid texture path.");
    }
    if (!path || path.split("/").some(part => !part || part === "." || part === "..")) {
      throw new Error("This 3MF package contains an unsafe texture path.");
    }
    const entry = zip.file(path);
    if (!entry) {
      throw new Error(`The 3MF package is missing its linked texture: ${path}`);
    }
    textures.set(texture.getAttribute("id"), await cacheAsset(path, await entry.async("blob")));
  }
  for (const group of elementChildren(resources, "texture2dgroup")) {
    const textureUrl = textures.get(group.getAttribute("texid"));
    if (textureUrl) {
      propertyGroups.set(group.getAttribute("id"), {
        kind: "texture",
        textureUrl,
        coordinates: elementChildren(group, "tex2coord").map(item => [
          Number(item.getAttribute("u")), Number(item.getAttribute("v")),
        ]),
      });
    }
  }

  const [
    { Mesh },
    { VertexData },
    { StandardMaterial },
    { Color3 },
    { Texture },
  ] = await Promise.all([
    import("@babylonjs/core/Meshes/mesh.js"),
    import("@babylonjs/core/Meshes/mesh.vertexData.js"),
    import("@babylonjs/core/Materials/standardMaterial.js"),
    import("@babylonjs/core/Maths/math.color.js"),
    import("@babylonjs/core/Materials/Textures/texture.js"),
  ]);
  const {scene} = viewerElement.viewerDetails;
  const materials = new Map();
  const materialFor = (key, group, color) => {
    if (materials.has(key)) {
      return materials.get(key);
    }
    const material = new StandardMaterial(`3MF material ${materials.size + 1}`, scene);
    material.specularColor = new Color3(0.12, 0.12, 0.12);
    if (group?.kind === "texture") {
      material.diffuseTexture = new Texture(group.textureUrl, scene, true, false);
    }
    else {
      material.diffuseColor = new Color3(color[0], color[1], color[2]);
      material.alpha = color[3];
    }
    materials.set(key, material);
    return material;
  };
  let triangleCount = 0;
  let meshCount = 0;

  const emitObject = (objectId, transforms = [], ancestry = new Set()) => {
    if (ancestry.has(objectId)) {
      return;
    }
    const object = objects.get(objectId);
    if (!object) {
      return;
    }
    const nextAncestry = new Set(ancestry).add(objectId);
    const meshData = elementChildren(object, "mesh")[0];
    if (meshData) {
      const verticesElement = elementChildren(meshData, "vertices")[0];
      const trianglesElement = elementChildren(meshData, "triangles")[0];
      const vertices = elementChildren(verticesElement, "vertex").map(vertex => [
        Number(vertex.getAttribute("x")),
        Number(vertex.getAttribute("y")),
        Number(vertex.getAttribute("z")),
      ]);
      const batches = new Map();
      for (const triangle of elementChildren(trianglesElement, "triangle")) {
        const corners = ["v1", "v2", "v3"].map(key => vertices[Number(triangle.getAttribute(key))]);
        if (corners.some(point => !point || point.some(value => !Number.isFinite(value)))) {
          continue;
        }
        const propertyId = triangle.getAttribute("pid");
        const group = propertyGroups.get(propertyId);
        const propertyIndex = Number(triangle.getAttribute("p1")) || 0;
        const color = group?.colors?.[propertyIndex] || [0.68, 0.68, 0.68, 1];
        const materialKey = group?.kind === "texture" ? `texture:${propertyId}` : `color:${propertyId}:${propertyIndex}`;
        let batch = batches.get(materialKey);
        if (!batch) {
          batch = { group, color, positions: [], uvs: [], indices: [] };
          batches.set(materialKey, batch);
        }
        const uvIndices = group?.kind === "texture" ? ["p1", "p2", "p3"].map(key => Number(triangle.getAttribute(key))) : [];
        for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex++) {
          const corner = corners[cornerIndex];
          let point = corner;
          for (let i = transforms.length - 1; i >= 0; i--) {
            point = transforms[i](point);
          }
          batch.positions.push(...point);
          if (group?.kind === "texture") {
            batch.uvs.push(...(group.coordinates[uvIndices[cornerIndex]] || [0, 0]));
          }
          batch.indices.push(batch.indices.length);
        }
      }
      for (const [materialKey, batch] of batches) {
        if (!batch.positions.length) {
          continue;
        }
        const mesh = new Mesh(`3MF part ${++meshCount}`, scene);
        const normals = [];
        VertexData.ComputeNormals(batch.positions, batch.indices, normals);
        const vertexData = new VertexData();
        vertexData.positions = batch.positions;
        vertexData.normals = normals;
        vertexData.indices = batch.indices;
        if (batch.uvs.length) {
          vertexData.uvs = batch.uvs;
        }
        vertexData.applyToMesh(mesh, true);
        mesh.material = materialFor(materialKey, batch.group, batch.color);
        triangleCount += batch.indices.length / 3;
      }
    }
    const componentGroup = elementChildren(object, "components")[0];
    for (const component of elementChildren(componentGroup, "component")) {
      emitObject(component.getAttribute("objectid"), [
        ...transforms,
        parse3mfTransform(component.getAttribute("transform")),
      ], nextAncestry);
    }
  };

  for (const item of elementChildren(build, "item")) {
    emitObject(item.getAttribute("objectid"), [parse3mfTransform(item.getAttribute("transform"))]);
  }
  if (!triangleCount) {
    for (const material of materials.values()) {
      material.dispose();
    }
    throw new Error("The 3MF package contains no supported triangle mesh.");
  }
  viewerElement.viewerDetails.markSceneMutated();
  viewerElement.viewerDetails.viewer.resetCamera(true);
  return triangleCount;
}

export default class ModelViewerModal extends Modal {
  constructor({ name, url, archiveKey, archivePath }) {
    super("modelviewer", `3D model · ${name}`, { text: "Close", cancel: true });
    this.name = name;
    this.url = url || "";
    this.archiveKey = archiveKey || "";
    this.archivePath = archivePath || "";
    this.abortController = new AbortController();
    this.assetUrls = new Map();
    this.entryPromises = new Map();
    this.viewerElement = null;

    this.el.setAttribute("aria-label", `3D model viewer: ${name}`);
    this.statusEl = dom("p", {
      classes: ["model-viewer-status"],
      attrs: { "role": "status", "aria-live": "polite" },
      text: "Preparing model…",
    });
    this.body.appendChild(this.statusEl);
    this.viewerHost = dom("div", { classes: ["model-viewer-host"] });
    this.body.appendChild(this.viewerHost);
  }

  onshown() {
    super.onshown();
    this.loadModel().catch(error => {
      if (error.name === "AbortError") {
        return;
      }
      console.error("3D model preview failed:", error);
      this.showError(error.message || "This model could not be opened.");
    });
  }

  async fetchBytes(url) {
    const response = await fetch(url, {
      credentials: "same-origin",
      signal: this.abortController.signal,
    });
    if (!response.ok) {
      throw new Error(response.status === 413 ?
        "This model asset is too large to preview in the browser." :
        `Could not read a model file (server returned ${response.status}).`);
    }
    const length = Number(response.headers.get("content-length")) || 0;
    if (length > MAX_MODEL_BYTES) {
      throw new Error("This model is larger than the 256 MB browser preview limit.");
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_MODEL_BYTES) {
      throw new Error("This model is larger than the 256 MB browser preview limit.");
    }
    return bytes;
  }

  async getArchiveEntry(path) {
    if (this.entryPromises.has(path)) {
      return this.entryPromises.get(path);
    }
    const promise = this.fetchBytes(archiveApiUrl(this.archiveKey, path));
    this.entryPromises.set(path, promise);
    return promise;
  }

  async cacheArchiveEntry(path) {
    if (this.assetUrls.has(path)) {
      return this.assetUrls.get(path);
    }
    const bytes = await this.getArchiveEntry(path);
    const url = URL.createObjectURL(new Blob([bytes], { type: modelMime(path) }));
    this.assetUrls.set(path, url);
    return url;
  }

  cacheEmbeddedAsset(path, blob) {
    if (this.assetUrls.has(path)) {
      return this.assetUrls.get(path);
    }
    const url = URL.createObjectURL(blob);
    this.assetUrls.set(path, url);
    return url;
  }

  async prepareArchiveModel() {
    const bytes = await this.getArchiveEntry(this.archivePath);
    const extension = extensionOf(this.archivePath);
    const fileName = this.archivePath.split("/").pop() || this.name;
    if (extension === ".3mf") {
      return { file: new File([bytes], fileName, { type: modelMime(fileName) }), extension, bytes };
    }
    if (extension === ".gltf" || extension === ".glb") {
      const { data, refs, externalRefs } = parseGltfReferences(bytes, extension);
      if (externalRefs.length) {
        throw new Error("This glTF links to files outside Hobbyfiles. Put its buffers and textures in a ZIP and open the model from that archive.");
      }
      if (refs.length > MAX_MODEL_ASSETS) {
        throw new Error("This model refers to too many external files to preview safely.");
      }
      const urls = new Map();
      for (const uri of refs) {
        const path = entryPath(this.archivePath, uri);
        urls.set(uri, await this.cacheArchiveEntry(path));
      }
      for (const group of [data.buffers || [], data.images || []]) {
        for (const entry of group) {
          if (entry.uri && urls.has(entry.uri)) {
            entry.uri = urls.get(entry.uri);
          }
        }
      }
      const prepared = extension === ".glb" ? rewriteGlbJson(bytes, data) : JSON.stringify(data);
      return { file: new File([prepared], fileName, { type: modelMime(fileName) }), extension };
    }
    if (extension === ".obj") {
      const { text, refs } = parseObjReferences(bytes);
      if (refs.some(ref => /^https?:|^file:/i.test(ref))) {
        throw new Error("This OBJ links to material files outside Hobbyfiles. Put its MTL and textures in a ZIP and open the model from that archive.");
      }
      if (refs.length > MAX_MODEL_ASSETS) {
        throw new Error("This model refers to too many material files to preview safely.");
      }
      let objText = text;
      for (const ref of refs) {
        const path = entryPath(this.archivePath, ref);
        let materialBytes;
        try {
          materialBytes = await this.getArchiveEntry(path);
        }
        catch {
          throw new Error(`The ZIP is missing the OBJ material file: ${path}`);
        }
        let materialText = new TextDecoder().decode(materialBytes);
        for (const textureRef of parseMtlTextureReferences(materialText)) {
          const texturePath = entryPath(path, textureRef);
          let textureUrl;
          try {
            textureUrl = await this.cacheArchiveEntry(texturePath);
          }
          catch {
            throw new Error(`The ZIP is missing an OBJ texture: ${texturePath}`);
          }
          materialText = materialText.replaceAll(textureRef, textureUrl);
        }
        const materialUrl = URL.createObjectURL(new Blob([materialText], { type: "text/plain" }));
        this.assetUrls.set(path, materialUrl);
        objText = objText.replaceAll(ref, materialUrl);
      }
      return { file: new File([objText], fileName, { type: modelMime(fileName) }), extension };
    }
    return { file: new File([bytes], fileName, { type: modelMime(fileName) }), extension };
  }

  async prepareDirectModel() {
    const bytes = await this.fetchBytes(this.url);
    const extension = extensionOf(this.name);
    if (extension === ".gltf" || extension === ".glb") {
      const { refs, externalRefs } = parseGltfReferences(bytes, extension);
      if (refs.length || externalRefs.length) {
        throw new Error(`This ${extension.slice(1).toUpperCase()} uses linked buffers or textures. Put the model and its assets in a ZIP, then open it from the archive.`);
      }
    }
    if (extension === ".obj" && parseObjReferences(bytes).refs.length) {
      if (parseObjReferences(bytes).refs.some(ref => /^https?:|^file:/i.test(ref))) {
        throw new Error("This OBJ links to files outside Hobbyfiles. Put the OBJ, MTL, and textures in a ZIP, then open the model from the archive.");
      }
      throw new Error("This OBJ uses a material file. Put the OBJ, MTL, and textures in a ZIP, then open the OBJ from the archive.");
    }
    return {
      file: new File([bytes], this.name, { type: modelMime(this.name) }),
      extension,
      bytes,
    };
  }

  async loadModel() {
    const { HTML3DElement } = await import("@babylonjs/viewer");
    if (!customElements.get("babylon-viewer")) {
      customElements.define("babylon-viewer", HTML3DElement);
    }
    this.viewerElement = document.createElement("babylon-viewer");
    this.viewerElement.classList.add("model-viewer-canvas");
    this.viewerElement.setAttribute("aria-label", `Interactive 3D preview of ${this.name}`);
    this.viewerElement.addEventListener("loadingprogresschange", () => {
      this.statusEl.textContent = "Loading model…";
    });
    this.viewerElement.addEventListener("modelerror", () => {
      this.showError("The model could not be rendered. Check that it is supported and that WebGL is enabled.");
    });
    this.viewerHost.appendChild(this.viewerElement);

    const viewer = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        error ? reject(error) : resolve(value);
      };
      const ready = () => {
        const details = this.viewerElement && this.viewerElement.viewerDetails;
        if (details && details.viewer) {
          finish(null, details.viewer);
        }
      };
      const timeout = setTimeout(() => finish(new Error("The 3D renderer did not start. Check that WebGL is enabled in your browser.")), 20000);
      this.viewerElement.addEventListener("viewerready", ready);
      this.abortController.signal.addEventListener("abort", () => {
        finish(new DOMException("Preview closed", "AbortError"));
      }, { once: true });
      ready();
    });

    this.statusEl.textContent = "Preparing model files…";
    const model = this.archiveKey && this.archivePath ?
      await this.prepareArchiveModel() :
      await this.prepareDirectModel();
    if (model.extension === ".3mf") {
      this.statusEl.textContent = "Building 3MF scene…";
      await load3mf(this.viewerElement, model.bytes, (path, blob) => this.cacheEmbeddedAsset(path, blob));
      this.statusEl.textContent = "3MF model · drag to rotate · scroll to zoom";
      return;
    }
    this.statusEl.textContent = "Loading model…";
    await viewer.loadModel(model.file, { pluginExtension: model.extension }, this.abortController.signal);
    this.statusEl.textContent = `${model.extension.slice(1).toUpperCase()} model · drag to rotate · scroll to zoom`;
  }

  showError(message) {
    this.statusEl.classList.add("is-error");
    this.statusEl.textContent = message;
  }

  onhidden() {
    this.abortController.abort();
    if (this.viewerElement) {
      this.viewerElement.remove();
      this.viewerElement = null;
    }
    for (const url of this.assetUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.assetUrls.clear();
    this.entryPromises.clear();
  }
}

export function openModelViewer(options) {
  return import("../registry").then(({ default: registry }) =>
    registry.roomie.showModal(new ModelViewerModal(options)));
}
