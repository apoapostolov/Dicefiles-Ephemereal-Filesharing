"use strict";

// Bound Argon2 memory per worker, including owner-triggered credential hashing.
let active = 0;
const waiting = [];

async function withVerificationSlot(operation) {
  if (active >= 2) {
    if (waiting.length >= 16) {
      throw Object.assign(new Error("Password verification is busy; try again"), { status: 429 });
    }
    await new Promise(resolve => waiting.push(resolve));
  }
  else {
    active++;
  }
  try {
    return await operation();
  }
  finally {
    const next = waiting.shift();
    if (next) {
      next();
    }
    else {
      active--;
    }
  }
}

module.exports = { withVerificationSlot };
