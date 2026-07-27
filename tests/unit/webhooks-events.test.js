"use strict";

const {
  VALID_EVENTS,
  isValidWebhookEvent,
  WebhookDispatcher,
} = require("../../lib/webhooks");

describe("webhook events (shipped)", () => {
  test("VALID_EVENTS includes linked-file and guest invite events", () => {
    expect(VALID_EVENTS.has("file_uploaded")).toBe(true);
    expect(VALID_EVENTS.has("linked_file_appeared")).toBe(true);
    expect(VALID_EVENTS.has("guest_invite_created")).toBe(true);
    expect(VALID_EVENTS.has("guest_invite_redeemed")).toBe(true);
    expect(isValidWebhookEvent("linked_file_appeared")).toBe(true);
    expect(isValidWebhookEvent("nope")).toBe(false);
  });

  test("normalizeHook accepts linked_file_appeared", () => {
    const d = new WebhookDispatcher();
    // Avoid loading real config side effects by calling normalizeHook only
    const hook = d.normalizeHook(
      {
        url: "https://example.org/hook",
        events: ["linked_file_appeared", "bogus", "file_uploaded"],
      },
      0,
      { retries: 1, baseDelayMs: 100, maxDelayMs: 1000 },
    );
    expect(hook).toBeTruthy();
    expect(hook.events.has("linked_file_appeared")).toBe(true);
    expect(hook.events.has("file_uploaded")).toBe(true);
    expect(hook.events.has("bogus")).toBe(false);
  });

  test("dispatch ignores unknown events; enqueues known ones", () => {
    const d = new WebhookDispatcher();
    d.config = {
      hooks: [
        {
          id: "t",
          url: "https://example.org/h",
          secret: "",
          events: new Set(["file_uploaded", "linked_file_appeared"]),
          retries: 0,
          timeoutMs: 1000,
        },
      ],
      defaults: { retries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      deadLetterLog: null,
    };
    d.queue = [];
    // Prevent async pump from draining the queue before assertions
    d.pump = () => {};
    d.dispatch("not_a_real_event", { x: 1 });
    expect(d.queue.length).toBe(0);
    d.dispatch("linked_file_appeared", { key: "k", roomid: "dest" });
    expect(d.queue.length).toBe(1);
    expect(d.queue[0].event).toBe("linked_file_appeared");
    expect(d.queue[0].payload.key).toBe("k");
  });
});
