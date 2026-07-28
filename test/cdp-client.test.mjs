import assert from "node:assert/strict";
import { test } from "node:test";

import { connectCdp } from "../test-ui/cdp-client.mjs";

class FakeSocket {
  constructor() {
    this.listeners = new Map();
    this.sent = [];
  }

  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) ?? [];
    entries.push({ listener, once: Boolean(options.once) });
    this.listeners.set(type, entries);
  }

  emit(type, event = {}) {
    const entries = [...(this.listeners.get(type) ?? [])];
    this.listeners.set(
      type,
      entries.filter(entry => !entry.once),
    );
    entries.forEach(entry => entry.listener(event));
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.emit("close");
  }
}

function socketFactory({ autoOpen = true } = {}) {
  let socket;
  return {
    WebSocketImpl: class extends FakeSocket {
      constructor() {
        super();
        socket = this;
        if (autoOpen) queueMicrotask(() => this.emit("open"));
      }
    },
    get socket() {
      return socket;
    },
  };
}

test("CDP connection rejects after a bounded timeout", async () => {
  const factory = socketFactory({ autoOpen: false });

  await assert.rejects(
    connectCdp("ws://prototype.test", {
      WebSocketImpl: factory.WebSocketImpl,
      connectionTimeoutMs: 10,
    }),
    /socket did not open after 10ms/i,
  );
});

test("closing the debugger socket before open rejects the connection", async () => {
  const factory = socketFactory({ autoOpen: false });
  const connection = connectCdp("ws://prototype.test", {
    WebSocketImpl: factory.WebSocketImpl,
    connectionTimeoutMs: 1_000,
  });

  factory.socket.emit("close");

  await assert.rejects(connection, /socket closed before opening/i);
});

test("CDP commands reject after a bounded timeout", async () => {
  const factory = socketFactory();
  const client = await connectCdp("ws://prototype.test", {
    WebSocketImpl: factory.WebSocketImpl,
    commandTimeoutMs: 10,
  });

  await assert.rejects(
    client.call("Runtime.evaluate"),
    /Runtime\.evaluate timed out after 10ms/,
  );
  client.close();
});

test("closing the debugger socket rejects pending commands", async () => {
  const factory = socketFactory();
  const client = await connectCdp("ws://prototype.test", {
    WebSocketImpl: factory.WebSocketImpl,
    commandTimeoutMs: 1_000,
  });
  const pending = client.call("Page.navigate");

  factory.socket.emit("close");

  await assert.rejects(pending, /debugger socket closed/i);
});

test("debugger socket errors reject pending commands", async () => {
  const factory = socketFactory();
  const client = await connectCdp("ws://prototype.test", {
    WebSocketImpl: factory.WebSocketImpl,
    commandTimeoutMs: 1_000,
  });
  const pending = client.call("Page.navigate");

  factory.socket.emit("error", { error: new Error("connection lost") });

  await assert.rejects(pending, /connection lost/i);
});

test("matching CDP responses resolve and clear their command timeout", async () => {
  const factory = socketFactory();
  const client = await connectCdp("ws://prototype.test", {
    WebSocketImpl: factory.WebSocketImpl,
    commandTimeoutMs: 25,
  });
  const pending = client.call("Runtime.evaluate", { expression: "1 + 1" });
  const [{ id }] = factory.socket.sent;

  factory.socket.emit("message", {
    data: JSON.stringify({ id, result: { value: 2 } }),
  });

  assert.deepEqual(await pending, { value: 2 });
  await new Promise(resolve => setTimeout(resolve, 35));
  client.close();
});
