"use strict";

const { EMITTER: LINKS } = require("../links");
const { CoalescedUpdate } = require("../util");

class LinkLister {
  constructor(room) {
    this.room = room;
    this.links = [];
    this.lastLinks = new Map();

    this.onadded = new CoalescedUpdate(1000, links => {
      links.forEach(e => {
        const j = JSON.stringify(e.toClientJSON());
        this.lastLinks.set(e.id, j);
      });
      this.room.emit("links", "add", links);
    });

    this.ondeleted = new CoalescedUpdate(250, links => {
      links.forEach(e => {
        this.lastLinks.delete(e.id);
      });
      this.room.emit("links", "deleted", links);
    });

    function update(type, links) {
      links = links.filter(e => {
        const j = JSON.stringify(e.toClientJSON());
        const rv = this.lastLinks.get(e.id) !== j;
        this.lastLinks.set(e.id, j);
        return rv;
      });
      if (!links.length) {
        return;
      }
      this.room.emit("links", type, links);
    }

    this.onupdated = new CoalescedUpdate(2000, update.bind(this, "updated"));

    this.onlink = this.onlink.bind(this);
    this.onclear = this.onclear.bind(this);
    Object.seal(this);

    LINKS.on(this.room.roomid, this.onlink);
    LINKS.on("clear", this.onclear);
  }

  onlink(action, link) {
    if (action === "add") {
      this.links.push(link);
      this.onadded.add(link);
      return;
    }

    if (action === "delete") {
      const idx = this.links.findIndex(e => link === e);
      if (idx < 0) {
        return;
      }
      this.links.splice(idx, 1);
      this.ondeleted.add(link);
      return;
    }

    if (action === "update") {
      const idx = this.links.findIndex(e => link.id === e.id);
      if (idx < 0) {
        return;
      }
      this.links.splice(idx, 1, link);
      this.onupdated.add(link);
      return;
    }
  }

  onclear() {
    this.links.length = 0;
    this.lastLinks.clear();
  }
}

module.exports = LinkLister;
