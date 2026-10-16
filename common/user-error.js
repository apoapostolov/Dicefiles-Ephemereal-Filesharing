"use strict";

const RECOVERY_MESSAGES = new Set([
  "This item changed after the report was prepared. Refresh the report before applying this action.",
  "This review action is no longer available. Refresh the bot report and choose a current item.",
  "This bot is already running. Wait for it to finish, refresh activity and retry this review action.",
  "Sign-in failed. Check your username and password, then try again.",
  "The verification code was not accepted. Enter a new code from your authenticator and check that your device clock is correct.",
  "Too many attempts. Wait a few minutes before trying again.",
  "Your session has expired or could not be verified. Refresh this page and sign in again.",
  "You do not have permission to complete this action. Sign in with an account that has access, or ask the room owner for help.",
  "This item is no longer available. Refresh the room or ask the sender for a current link.",
  "The service could not complete the request. Check your connection, then try again. If the problem continues, contact the site operator.",
  "There is not enough capacity for this upload. Choose a smaller file or ask the site operator to check storage and upload limits.",
  "The action could not be completed. Refresh the page and try again. If it happens again, contact the site operator with the action you were taking."
]);

// Keep technical details in operator logs. Never include URLs, paths or secrets
// from an exception in the recovery message shown to a visitor.
function userError(error, status) {
  const message = String(error && error.message || error || "");
  if (RECOVERY_MESSAGES.has(message)) {
    return message;
  }
  if (/username or password|invalid user|invalid account|incorrect password/i.test(message)) {
    return "Sign-in failed. Check your username and password, then try again.";
  }
  if (/two.factor|two factor/i.test(message)) {
    return "The verification code was not accepted. Enter a new code from your authenticator and check that your device clock is correct.";
  }
  if (status === 429 || /too many|rate.limit|flood/i.test(message)) {
    return "Too many attempts. Wait a few minutes before trying again.";
  }
  if (/token|session|not logged|not authenticated/i.test(message) || status === 401) {
    return "Your session has expired or could not be verified. Refresh this page and sign in again.";
  }
  if (/not authorized|permission|access denied|forbidden/i.test(message) || status === 403) {
    return "You do not have permission to complete this action. Sign in with an account that has access, or ask the room owner for help.";
  }
  if (/not found|unknown room|expired|no longer available/i.test(message) || status === 404) {
    return "This item is no longer available. Refresh the room or ask the sender for a current link.";
  }
  if (/timeout|timed out|network|fetch|connection|offline/i.test(message) || status >= 500) {
    return "The service could not complete the request. Check your connection, then try again. If the problem continues, contact the site operator.";
  }
  if (/too large|size limit|quota|disk|storage|space/i.test(message) || status === 413) {
    return "There is not enough capacity for this upload. Choose a smaller file or ask the site operator to check storage and upload limits.";
  }
  if (/required|must |too short|too long|empty|invalid|unsupported|not supported|disabled|already taken/i.test(message) &&
      message.length < 240 && !/[/\\]|https?:|\bat\b.*\d+:\d+/.test(message)) {
    return `${message.replace(/[.!]+$/, "")}. Check the entered values and the room settings, then try again.`;
  }
  return "The action could not be completed. Refresh the page and try again. If it happens again, contact the site operator with the action you were taking.";
}

module.exports = { userError };
