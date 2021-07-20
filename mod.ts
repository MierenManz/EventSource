interface EventSourceInit {
  withCredentials: boolean;
}

type EventHandler = (e: { data: string }) => void | Promise<void>;
type VoidFunction = () => void | Promise<void>;

interface CorsAttributeState {
  mode: "cors";
  credentials: "same-origin" | "include";
}

interface PartialRequest extends Partial<CorsAttributeState> {
  cache: "no-store";
  headers: Headers;
  signal: AbortSignal;
  keepalive: boolean;
}

interface Settings {
  url: URL | string;
  request: PartialRequest | null;
  reconnectionTime: number;
  lastEventID: string;
}

export class EventSource extends EventTarget {
  withCredentials = false;

  #readyState: 0 | 1 | 2 = 0;

  get readyState(): 0 | 1 | 2 {
    return this.#readyState;
  }

  #corsAtrributeState: CorsAttributeState = {
    mode: "cors",
    credentials: "same-origin",
  };

  #settings: Settings = {
    url: "",
    request: null,
    reconnectionTime: 1500,
    lastEventID: "",
  };
  #firstTime = true;
  #abortController = new AbortController();

  get url(): string {
    return new URL(this.#settings.url.toString()).toString();
  }

  onopen: VoidFunction | null = null;
  onmessage: EventHandler | null = null;
  onerror: VoidFunction | null = null;

  constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
    super();

    try {
      const urlRecord = new URL(url.toString());
      this.#settings.url = urlRecord;
    } catch (e) {
      throw new SyntaxError(e.message);
    }

    if (eventSourceInitDict?.withCredentials) {
      this.#corsAtrributeState.credentials = "include";
      this.withCredentials = true;
    }

    this.#settings.request = {
      cache: "no-store",
      headers: new Headers([["Accept", "text/event-stream"]]),
      ...this.#corsAtrributeState,
      signal: this.#abortController.signal,
      keepalive: true,
    };

    this.#fetch();
    return;
  }

  close(): void {
    this.#readyState = 2;
    this.#abortController.abort();
  }

  async #fetch(): Promise<void> {
    while (this.#readyState < 2) {
      const res = await fetch(this.url, this.#settings.request!)
      .catch(() => void (0));

    if (
      res?.status === 200 &&
      res.headers.get("content-type")?.startsWith("text/event-stream")
    ) {
      // Announce connection
      if (this.#readyState !== 2 && this.#firstTime) {
        this.#firstTime = false;
        this.#readyState = 1;
        this.dispatchEvent(new Event("open"));
        if (this.onopen) await this.onopen();

        // Data processing
      }
    } else {
      // Connection failed for whatever reason
      // No retry
      console.log("WHAT")
      this.#readyState = 2;
      this.dispatchEvent(new Event("error"));
      if (this.onerror) await this.onerror();
      continue;
    }
      // Set readyState to CONNECTING
      this.#readyState = 0;

      // Fire onerror
      this.dispatchEvent(new Event("error"));
      if (this.onerror) await this.onerror();

      // Timeout for reestablishing the connection
      await new Promise((res) =>
        setTimeout(res, this.#settings.reconnectionTime)
      );

      if (this.#readyState !== 0) break;

      if (this.#settings.lastEventID) {
        this.#settings.request?.headers.set(
          "Last-Event-ID",
          this.#settings.lastEventID,
        );
      }
    }
  }
}

const s = new EventSource("http://localhost:8000");
s.addEventListener("open", (ree) => {
  console.log(ree, "CONNECTION OPEN ON addEventListener");
});
s.onopen = () => console.log("CONNECTION OPEN ON onopen");
s.onerror = () => console.log("SOME ERROR ;-;");
s.addEventListener("error", (ree) => console.log(ree));
await new Promise(r => setTimeout(r, 5000));
console.log("timeout done, closing");
s.close();