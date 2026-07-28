function socketError(event, fallback) {
  if (event?.error instanceof Error) return event.error;
  if (typeof event?.message === "string" && event.message) {
    return new Error(event.message);
  }
  return new Error(fallback);
}

export async function connectCdp(
  webSocketUrl,
  {
    WebSocketImpl = globalThis.WebSocket,
    connectionTimeoutMs = 5_000,
    commandTimeoutMs = 5_000,
  } = {},
) {
  if (typeof WebSocketImpl !== "function") {
    throw new Error(
      "A WebSocket implementation is required to connect to Chrome DevTools",
    );
  }
  for (const [name, value] of [
    ["connectionTimeoutMs", connectionTimeoutMs],
    ["commandTimeoutMs", commandTimeoutMs],
  ]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive number`);
    }
  }

  const socket = new WebSocketImpl(webSocketUrl);
  const pending = new Map();
  let commandId = 0;

  await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `Chrome debugger socket did not open after ${connectionTimeoutMs}ms`,
        ),
      );
    }, connectionTimeoutMs);
    const settle = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };

    socket.addEventListener("open", settle(resolve), { once: true });
    socket.addEventListener(
      "error",
      settle(event =>
        reject(socketError(event, "Debugger socket failed to open")),
      ),
      { once: true },
    );
    socket.addEventListener(
      "close",
      settle(() =>
        reject(new Error("Chrome debugger socket closed before opening")),
      ),
      { once: true },
    );
  });

  function rejectPending(error) {
    for (const { reject, timeout } of pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    pending.clear();
  }

  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const command = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(command.timeout);
    if (message.error) command.reject(new Error(message.error.message));
    else command.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    rejectPending(new Error("Chrome debugger socket closed"));
  });
  socket.addEventListener("error", event => {
    rejectPending(socketError(event, "Chrome debugger socket failed"));
  });

  return {
    close() {
      rejectPending(new Error("Chrome debugger client closed"));
      socket.close();
    },
    call(method, params = {}) {
      const id = ++commandId;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error(`${method} timed out after ${commandTimeoutMs}ms`),
          );
        }, commandTimeoutMs);
        pending.set(id, { resolve, reject, timeout });

        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          clearTimeout(timeout);
          pending.delete(id);
          reject(error);
        }
      });
    },
  };
}
