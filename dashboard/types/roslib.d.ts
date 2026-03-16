declare module "roslib" {
  export class Ros {
    constructor(options: { url: string });
    isConnected: boolean;
    on(event: "connection" | "error" | "close", callback: (event?: unknown) => void): void;
    close(): void;
  }

  export class Topic {
    constructor(options: { ros: Ros; name: string; messageType: string });
    publish(message: Record<string, unknown>): void;
    subscribe(callback: (message: Record<string, unknown>) => void): void;
    unsubscribe(): void;
  }
}
