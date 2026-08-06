import "@testing-library/jest-dom/vitest";

class TestEventSource {
  addEventListener() {}

  close() {}
}

Object.defineProperty(globalThis, "EventSource", {
  configurable: true,
  value: TestEventSource,
});
