async function installWebSocketMock(page, events, options = {}) {
  const targetPath = String(options.targetPath || "/ws");
  const captureStorageKey = String(options.captureStorageKey || "");
  const captureActions = Array.isArray(options.captureActions)
    ? options.captureActions.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const logQueryFixtures = Array.isArray(options.logQueryFixtures)
    ? options.logQueryFixtures
    : [];
  await page.addInitScript(
    ({
      initialEvents,
      socketTargetPath,
      messageCaptureStorageKey,
      messageCaptureActions,
      initialLogQueryFixtures,
    }) => {
      const NativeWebSocket = window.WebSocket;
      if (typeof NativeWebSocket !== "function") {
        return;
      }
      if (messageCaptureStorageKey) {
        window[messageCaptureStorageKey] = [];
      }
      const normalizeText = (value) => {
        const normalized = typeof value === "string" ? value.trim() : String(value || "").trim();
        return normalized || null;
      };
      const logQueryFixtures = Array.isArray(initialLogQueryFixtures)
        ? initialLogQueryFixtures.map((fixture, fixtureIndex) => ({
          streamId: normalizeText(fixture?.streamId) || "merged",
          lines: Array.isArray(fixture?.lines) ? fixture.lines : [],
          context: {
            scope: normalizeText(fixture?.context?.scope) || "runtime",
            contextKey: normalizeText(fixture?.context?.contextKey),
            projectPath: normalizeText(fixture?.context?.projectPath),
            hostId: fixture?.context?.hostId === null || fixture?.context?.hostId === undefined || fixture?.context?.hostId === ""
              ? null
              : Number.parseInt(fixture.context.hostId, 10),
            hostName: normalizeText(fixture?.context?.hostName),
            hostIp: normalizeText(fixture?.context?.hostIp),
            hostAgentUuid: normalizeText(fixture?.context?.hostAgentUuid),
          },
          fixtureIndex,
        }))
        : [];

      const findLogQueryFixture = (requestContext, requestedStreamId) => {
        const normalizedStreamId = normalizeText(requestedStreamId) || "merged";
        return logQueryFixtures.find((fixture) => {
          if ((fixture.streamId || "merged") !== normalizedStreamId) {
            return false;
          }
          if (fixture.context.contextKey) {
            return fixture.context.contextKey === normalizeText(requestContext?.contextKey);
          }
          if ((fixture.context.scope || "runtime") !== (normalizeText(requestContext?.scope) || "runtime")) {
            return false;
          }
          if (fixture.context.projectPath && fixture.context.projectPath !== normalizeText(requestContext?.projectPath)) {
            return false;
          }
          if (fixture.context.hostId !== null) {
            const requestedHostId = requestContext?.hostId === null || requestContext?.hostId === undefined || requestContext?.hostId === ""
              ? null
              : Number.parseInt(requestContext.hostId, 10);
            if (requestedHostId !== fixture.context.hostId) {
              return false;
            }
          }
          if (fixture.context.hostName && fixture.context.hostName !== normalizeText(requestContext?.hostName)) {
            return false;
          }
          if (fixture.context.hostIp && fixture.context.hostIp !== normalizeText(requestContext?.hostIp)) {
            return false;
          }
          if (fixture.context.hostAgentUuid && fixture.context.hostAgentUuid !== normalizeText(requestContext?.hostAgentUuid)) {
            return false;
          }
          return true;
        }) || null;
      };

      const buildLogQueryResultStream = (requestedStream, fixture) => {
        const sourceLines = Array.isArray(fixture?.lines) ? fixture.lines : [];
        const totalLines = sourceLines.length;
        const limit = Math.max(0, Number.parseInt(requestedStream?.limit, 10) || 0);
        const rawOffset = Number.parseInt(requestedStream?.offset, 10) || 0;
        const resolvedOffset = rawOffset < 0
          ? Math.max(0, totalLines + rawOffset)
          : Math.max(0, rawOffset);
        return {
          streamId: normalizeText(requestedStream?.streamId) || normalizeText(fixture?.streamId) || "merged",
          totalLines,
          offset: resolvedOffset,
          lines: sourceLines.slice(resolvedOffset, resolvedOffset + limit),
        };
      };

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
            if (parsed.action === "logs.query") {
              const requestedStreams = Array.isArray(parsed.streams) ? parsed.streams : [];
              const resultStreams = requestedStreams.map((requestedStream) => {
                const fixture = findLogQueryFixture(parsed.context, requestedStream?.streamId);
                if (!fixture) {
                  return null;
                }
                return buildLogQueryResultStream(requestedStream, fixture);
              }).filter(Boolean);
              if (resultStreams.length === 0) {
                return;
              }
              setTimeout(() => {
                this._emit("message", {
                  data: JSON.stringify({
                    kind: "logs.query.result",
                    requestId: normalizeText(parsed.requestId),
                    contextKey: normalizeText(parsed?.context?.contextKey),
                    scope: normalizeText(parsed?.context?.scope) || "runtime",
                    streams: resultStreams,
                    serverTime: new Date().toISOString(),
                  }),
                });
              }, 0);
            }
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
      initialLogQueryFixtures: logQueryFixtures,
    },
  );
}

module.exports = {
  installWebSocketMock,
};
