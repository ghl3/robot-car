declare module "roslib" {
  export class Ros {
    constructor(options: { url: string });
    isConnected: boolean;
    on(event: "connection" | "error" | "close", callback: (event?: Event) => void): void;
    close(): void;
  }

  export class Topic {
    constructor(options: { ros: Ros; name: string; messageType: string });
    publish(message: Message): void;
    subscribe(callback: (message: Record<string, unknown>) => void): void;
    unsubscribe(): void;
  }

  export class Message {
    constructor(data: Record<string, unknown>);
  }

  const ROSLIB: {
    Ros: typeof Ros;
    Topic: typeof Topic;
    Message: typeof Message;
  };

  export default ROSLIB;
}
