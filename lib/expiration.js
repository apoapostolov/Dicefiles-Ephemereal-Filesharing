"Use strict";

const {Expirer: UploadExpirer} = require("./upload");
const {Expirer: RequestExpirer} = require("./request");

const UEXPIRER = new UploadExpirer();
const REXPIRER = new RequestExpirer();

async function expireOnce() {
  await UEXPIRER.expire();
  await REXPIRER.expire();
}

async function expire() {
  try {
    await expireOnce();
  }
  catch (ex) {
    console.error("Expiration failed", ex);
  }
  setTimeout(expire, 10000);
}

console.log(`Expiration ${process.pid.toString().bold} is running`);
expire();
