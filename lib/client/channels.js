"use strict";

const BROKER = require("../broker");

class Channels extends Set {
  constructor(owner) {
    super();
    this.owner = owner;
    BROKER.on("message", owner.unicast);
    BROKER.on(`${owner.roomid}:message`, owner.unicast);
  }

  add(channel) {
    if (this.has(channel)) {
      return this;
    }
    super.add(channel);
    BROKER.on(`message:${channel}`, this.owner.unicast);
    BROKER.on(`${this.owner.roomid}:message:${channel}`, this.owner.unicast);
    return this;
  }

  delete(channel) {
    if (!super.delete(channel)) {
      return false;
    }
    BROKER.removeListener(`message:${channel}`, this.owner.unicast);
    BROKER.removeListener(
      `${this.owner.roomid}:message:${channel}`,
      this.owner.unicast,
    );
    return true;
  }

  clear() {
    for (const c of Array.from(this)) {
      this.delete(c);
    }
    BROKER.removeListener("message", this.owner.unicast);
    BROKER.removeListener(`${this.owner.roomid}:message`, this.owner.unicast);
  }
}


module.exports = { Channels };
