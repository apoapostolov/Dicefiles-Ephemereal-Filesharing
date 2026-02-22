"Use strict";

const { Expirer: UploadExpirer } = require("./upload");
const { Expirer: RequestExpirer } = require("./request");
const { Room } = require("./room");

const UEXPIRER = new UploadExpirer();
const REXPIRER = new RequestExpirer();

async function expireOnce() {
  await UEXPIRER.expire();
  await REXPIRER.expire();
}

async function expire() {
  try {
    await expireOnce();
  } catch (ex) {
    console.error("Expiration failed", ex);
  }
  setTimeout(expire, 10000);
}

async function pruneOnce() {
  try {
    await Room.prune();
  } catch (ex) {
    console.error("Room pruning failed", ex);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

console.log(`Expiration ${process.pid.toString().bold} is running`);
expire();
// Run an initial prune shortly after startup, then once every 24 h
setTimeout(() => {
  pruneOnce();
  setInterval(pruneOnce, DAY_MS);
}, 60 * 1000);
