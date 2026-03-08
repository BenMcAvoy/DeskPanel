// RotaryEncoder.ts
export type RotaryEvent =
  | { type: "rotate"; delta: number }
  | { type: "button"; pressed: boolean };

type RotaryCallback = (event: RotaryEvent) => void;
type StatusCallback = (connected: boolean) => void;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;

export class RotaryEncoder {
  private url: string;
  private ws!: WebSocket;
  private callbacks: RotaryCallback[] = [];
  private statusCallbacks: StatusCallback[] = [];
  private attempt = 0;
  private destroyed = false;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  private connect() {
    if (this.destroyed) return;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log("RotaryEncoder connected");
      this.attempt = 0;
      this.statusCallbacks.forEach((cb) => cb(true));
    };

    this.ws.onmessage = (msg) => {
      try {
        const data: RotaryEvent = JSON.parse(msg.data);
        this.callbacks.forEach((cb) => cb(data));
      } catch (e) {
        console.error("Failed to parse rotary encoder message", e);
      }
    };

    this.ws.onclose = () => {
      if (this.destroyed) return;
      this.statusCallbacks.forEach((cb) => cb(false));
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
      console.log(`RotaryEncoder disconnected — reconnecting in ${delay}ms (attempt ${this.attempt + 1})`);
      this.attempt++;
      setTimeout(() => this.connect(), delay);
    };

    this.ws.onerror = () => {
      // onerror is always followed by onclose, which handles reconnect
    };
  }

  onEvent(cb: RotaryCallback) {
    this.callbacks.push(cb);
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== cb);
    };
  }

  onStatus(cb: StatusCallback) {
    this.statusCallbacks.push(cb);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((c) => c !== cb);
    };
  }

  send(data: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  close() {
    this.destroyed = true;
    this.ws.close();
  }
}