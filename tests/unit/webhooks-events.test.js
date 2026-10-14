"use strict";

jest.mock("../../lib/upload", () => ({ UPLOADS: new (require("events").EventEmitter)() }));
jest.mock("../../lib/request", () => ({ REQUESTS: new (require("events").EventEmitter)() }));
jest.mock("../../lib/room", () => ({ Room: { get: async () => null } }));
jest.mock("../../lib/plugins/registry", () => ({ defaultRegistry: { emitEvent: jest.fn() } }));

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

  test("dispatch ignores unknown events; enqueues known ones", async () => {
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
    d.outbox = { enqueue: jest.fn().mockResolvedValue(true) };
    // Prevent async pump from draining the queue before assertions
    d.pump = () => {};
    d.dispatch("not_a_real_event", { x: 1 });
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
    d.dispatch("linked_file_appeared", { key: "k", roomid: "dest" });
    await new Promise(resolve => setImmediate(resolve));
    expect(d.outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(d.outbox.enqueue.mock.calls[0][0]).toMatchObject({ event: "linked_file_appeared", payload: { key: "k" } });
  });
});
