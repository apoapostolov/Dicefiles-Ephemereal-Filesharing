"use strict";

import registry from "client/registry";
const initPromise = registry.init().catch(console.error);

addEventListener("DOMContentLoaded", function load() {
  initPromise.
    then(() => registry.messages && registry.messages.restore()).
    catch(console.error);
}, {capture: true, once: true});
