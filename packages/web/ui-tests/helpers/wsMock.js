async function installWebSocketMock(page, events, options = {}) {
  const targetPath = String(options.targetPath || "/ws");
  const captureStorageKey = String(options.captureStorageKey || "");
  const captureActions = Array.isArray(options.captureActions)
    ? options.captureActions.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  await page.addInitScript(
    ({ initialEvents, socketTargetPath, messageCaptureStorageKey, messageCaptureActions }) => {
      const NativeWebSocket = window.WebSocket;
      if (typeof NativeWebSocket !== "function") {
        return;
      }
      if (messageCaptureStorageKey) {
        window[messageCaptureStorageKey] = [];
      }

      class MockWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        constructor(url, protocols) {
          this.url = typeof url === "string" ? url : String(url || "");
          this.readyState = MockWebSocket.CONNECTING;
          this.bufferedAmount = 0;
          this.onopen = null;
          this.onmessage = null;
          this.onerror = null;
          this.onclose = null;
          this._listeners = {
            open: new Set(),
            message: new Set(),
            error: new Set(),
            close: new Set(),
          };
          this._nativeSocket = null;
          this._mockedSocket = this.url.includes(socketTargetPath);

          if (this._mockedSocket) {
            setTimeout(() => {
              this.readyState = MockWebSocket.OPEN;
              this._emit("open", { type: "open" });
            }, 0);
            return;
          }

          this._nativeSocket = new NativeWebSocket(url, protocols);
          this.readyState = this._nativeSocket.readyState;
          this._nativeSocket.addEventListener("open", (event) => {
            this.readyState = this._nativeSocket.readyState;
            this._emit("open", event);
          });
          this._nativeSocket.addEventListener("message", (event) => {
            this._emit("message", event);
          });
          this._nativeSocket.addEventListener("error", (event) => {
            this._emit("error", event);
          });
          this._nativeSocket.addEventListener("close", (event) => {
            this.readyState = this._nativeSocket.readyState;
            this._emit("close", event);
          });
        }

        addEventListener(type, listener) {
          if (!this._listeners[type] || typeof listener !== "function") {
            return;
          }
          this._listeners[type].add(listener);
        }

        removeEventListener(type, listener) {
          if (!this._listeners[type] || typeof listener !== "function") {
            return;
          }
          this._listeners[type].delete(listener);
        }

        send(rawMessage) {
          if (!this._mockedSocket) {
            if (this._nativeSocket) {
              this._nativeSocket.send(rawMessage);
            }
            return;
          }

          let parsed = null;
          try {
            parsed = JSON.parse(rawMessage);
          } catch {
            parsed = null;
          }
          if (!parsed) {
            return;
          }

          if (
            messageCaptureStorageKey
            && parsed.action
            && messageCaptureActions.includes(String(parsed.action))
            && Array.isArray(window[messageCaptureStorageKey])
          ) {
            window[messageCaptureStorageKey].push(parsed);
          }

          if (parsed.action !== "subscribe") {
            return;
          }

          setTimeout(() => {
            for (const eventPayload of initialEvents) {
              this._emit("message", { data: JSON.stringify(eventPayload) });
            }
          }, 0);
        }

        close(code, reason) {
          if (!this._mockedSocket) {
            if (this._nativeSocket) {
              this._nativeSocket.close(code, reason);
            }
            return;
          }
          this.readyState = MockWebSocket.CLOSED;
          this._emit("close", {
            code: Number.isInteger(code) ? code : 1000,
            reason: String(reason || ""),
            wasClean: true,
          });
        }

        _emit(type, event) {
          const handler = this[`on${type}`];
          if (typeof handler === "function") {
            handler.call(this, event);
          }
          const listeners = this._listeners[type];
          if (!listeners) {
            return;
          }
          for (const listener of listeners) {
            listener.call(this, event);
          }
        }
      }

      window.WebSocket = MockWebSocket;
    },
    {
      initialEvents: Array.isArray(events) ? events : [],
      socketTargetPath: targetPath,
      messageCaptureStorageKey: captureStorageKey,
      messageCaptureActions: captureActions,
    },
  );
}

module.exports = {
  installWebSocketMock,
};
