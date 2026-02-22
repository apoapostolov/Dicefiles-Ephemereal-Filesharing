"use strict";

import chatbox from "./chatbox";
import config from "./config";
import files from "./files";
import links from "./links";
import messages from "./messages";
import privmsg from "./privmsg";
import reload from "./reload";
import roomie from "./roomie";
import socket from "./socket";
import splitter from "./splitter";
import "./templates";

export default new (class Registry {
  constructor() {
    this._initPromise = null;
    this._inited = false;
    Object.defineProperty(this, "roomid", {
      value: document.location.pathname.replace(/^\/r\//, ""),
      enumerable: true,
    });
  }

  async init() {
    if (this._inited) {
      return this;
    }
    if (this._initPromise) {
      return this._initPromise;
    }
    const components = {
      socket,
      config,
      messages,
      roomie,
      chatbox,
      files,
      links,
      reload,
      splitter,
      privmsg,
    };

    this._initPromise = (async () => {
      for (const [k, component] of Object.entries(components)) {
        this[k] = component;
      }

      const resolved = {};
      for (const [k, component] of Object.entries(components)) {
        let instance = component;
        if (typeof component === "function") {
          instance = component();
          if (instance && instance.then) {
            instance = await instance;
          }
        }
        resolved[k] = instance;
        this[k] = instance;
      }

      for (const instance of Object.values(resolved)) {
        if (instance && typeof instance.init === "function") {
          const rv = instance.init();
          if (rv && rv.then) {
            await rv;
          }
        }
      }
      this._inited = true;
      return this;
    })().catch(ex => {
      this._inited = false;
      this._initPromise = null;
      throw ex;
    });

    return await this._initPromise;
  }
})();
