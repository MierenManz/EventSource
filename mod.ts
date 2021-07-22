interface EventSourceInit {
  withCredentials: boolean;
}

type EventHandler<Evt extends Event> = (e: Evt) => void | Promise<void>;

interface Settings {
  url: string;
  fetchSettings: {
    headers: string[][];
    credentials: "same-origin" | "include";
    mode: "cors";
  };
  reconnectionTime: number;
  lastEventID: string;
}

export class EventSource extends EventTarget {
  #withCredentials = false;
  #readyState: 0 | 1 | 2 = 0;
  #abortController = new AbortController();
  #settings: Settings = {
    url: "",
    fetchSettings: {
      headers: [["Accept", "text/event-stream"]],
      credentials: "same-origin",
      mode: "cors",
    },
    reconnectionTime: 2200,
    lastEventID: "",
  };

  onopen: EventHandler<Event> | null = null;
  onmessage: EventHandler<MessageEvent<string>> | null = null;
  onerror: EventHandler<Event> | null = null;

  CONNECTING: 0 = 0;
  OPEN: 1 = 1;
  CLOSED: 2 = 2;

  get readyState(): 0 | 1 | 2 {
    return this.#readyState;
  }

  get url(): string {
    return this.#settings.url;
  }

  get withCredentials(): boolean {
    return this.#withCredentials;
  }

  constructor(url: string, eventSourceInitDict?: EventSourceInit) {
    super();

    try {
      // Allow empty url
      // https://github.com/web-platform-tests/wpt/blob/master/eventsource/eventsource-constructor-empty-url.any.js
      this.#settings.url = url == ""
        ? window.location.toString()
        : new URL(url, window.location.href).toString();
    } catch (e) {
      // Dunno if this is allowd in the spec. But handy for testing purposes
      if (e instanceof ReferenceError) {
        this.#settings.url = new URL(url).toString();
      } else throw new DOMException(e.message, "SyntaxError");
    }

    if (eventSourceInitDict?.withCredentials) {
      this.#settings.fetchSettings.credentials = "include";
      this.#withCredentials = true;
    }

    this.#fetch();
    return;
  }

  close(): void {
    this.#readyState = this.CLOSED;
    this.#abortController.abort();
  }

  async #fetch(): Promise<void> {
    let currentRetries = 0;
    while (this.#readyState < this.CLOSED) {
      const res = await fetch(this.url, {
        cache: "no-store",
        // This seems to cause problems if the abort happens while `res.body` is being used
        // signal: this.#abortController.signal,
        keepalive: true,
        redirect: "follow",
        ...this.#settings.fetchSettings,
      }).catch(() => void (0));

      if (
        res?.body &&
        res?.status === 200 &&
        res.headers.get("content-type")?.startsWith("text/event-stream")
      ) {
        // Announce connection
        if (this.#readyState !== this.CLOSED) {
          this.#readyState = this.OPEN;
          const openEvent = new Event("open", {
            bubbles: false,
            cancelable: false,
          });
          super.dispatchEvent(openEvent);
          if (this.onopen) this.onopen(openEvent);
        }

        // Decode body for interpreting
        const decoder = new TextDecoderStream("utf-8", {
          ignoreBOM: false,
          fatal: false,
        });
        const reader = res.body.pipeThrough(decoder);

        // Initiate buffers
        let lastEventIDBuffer = "";
        let eventTypeBuffer = "";
        let messageBuffer = "";
        let readBuffer = "";
        // REF: https://github.com/MierenManz/EventSource/issues/8
        // This for loop causes an uncaught exception in `eventsource/request-redirect.html`
        for await (const chunk of reader) {
          if (this.#abortController.signal.aborted) break;
          const lines = decodeURIComponent(readBuffer + chunk)
            .replaceAll("\r\n", "\n")
            .replaceAll("\r", "\n")
            .split("\n");
          readBuffer = lines.pop() ?? "";

          // Start loop for interpreting
          for (const line of lines) {
            if (!line) {
              this.#settings.lastEventID = lastEventIDBuffer;

              // Check if buffer is not an empty string
              if (messageBuffer) {
                // Create event
                if (!eventTypeBuffer) {
                  eventTypeBuffer = "message";
                }

                const event = new MessageEvent<string>(eventTypeBuffer, {
                  data: messageBuffer.trim(),
                  origin: res.url,
                  lastEventId: this.#settings.lastEventID,
                  cancelable: false,
                  bubbles: false,
                });

                if (this.readyState !== this.CLOSED) {
                  // Fire event
                  super.dispatchEvent(event);
                  if (this.onmessage) this.onmessage(event);
                }
              }

              // Clear buffers
              messageBuffer = "";
              eventTypeBuffer = "";
              continue;
            }

            // Ignore comments
            if (line[0] === ":") continue;

            let splitIndex = line.indexOf(":");
            splitIndex = splitIndex > 0 ? splitIndex : line.length;
            const field = line.slice(0, splitIndex).trim();
            const data = line.slice(splitIndex + 1).trim();
            switch (field) {
              case "event":
                // Set fieldBuffer to Field Value
                eventTypeBuffer = data;
                break;
              case "data":
                // append Field Value to dataBuffer
                messageBuffer += `${data}\n`;
                break;
              case "id":
                // set lastEventID to Field Value
                if (data && data !== "NULL") {
                  lastEventIDBuffer = data;
                }
                break;
              case "retry": {
                // set reconnectionTime to Field Value if int
                const num = Number(data);
                if (!isNaN(num) && isFinite(num)) {
                  this.#settings.reconnectionTime = num;
                }
                break;
              }
            }
          }
        }
        if (this.#abortController.signal.aborted) {
          // Cancel reader to close the EventSource properly
          await reader.cancel();
          this.#readyState = this.CLOSED;
          break;
        }
      } else {
        // Connection failed for whatever reason
        this.#readyState = this.CLOSED;
        this.#abortController.abort();
        const errorEvent = new Event("error", {
          bubbles: false,
          cancelable: false,
        });
        super.dispatchEvent(errorEvent);
        if (this.onerror) this.onerror(errorEvent);
        if (currentRetries >= 3) break;
        currentRetries++;
      }

      // Set readyState to CONNECTING
      if (this.#readyState !== this.CLOSED) {
        this.#readyState = this.CONNECTING;

        // Fire onerror
        const errorEvent = new Event("error", {
          bubbles: false,
          cancelable: false,
        });

        super.dispatchEvent(errorEvent);
        if (this.onerror) this.onerror(errorEvent);

        // Timeout for re-establishing the connection
        await new Promise<void>((res) => {
          const id = setTimeout(() => res(clearTimeout(id)), this.#settings.reconnectionTime);
        });

        if (this.#readyState !== this.CONNECTING) break;

        if (this.#settings.lastEventID) {
          this.#settings.fetchSettings.headers.push([
            "Last-Event-ID",
            this.#settings.lastEventID,
          ]);
        }
      }
    }
  }
}
