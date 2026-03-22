# ROS Communication Architecture

## Overview

The dashboard communicates with the robot via rosbridge WebSocket (port 9090) using roslib v2.1.0. There is a single connection hook (`useRobot`) and multiple subscription hooks.

## Architecture

```
useRobot()          — connection lifecycle + publish()
  ├── useTopic()    — subscribe, writes to state (triggers re-renders)
  ├── useTopicRef() — subscribe, writes to ref (no re-renders)
  └── usePose()     — specialized /tf transform composition
```

## Publishing

`publish()` caches a `Topic` object per topic name and reuses it across calls. roslib auto-advertises internally on the first `publish()`, so no manual `advertise()` call is needed. The cache is cleared on disconnect/reconnect so stale topics referencing a dead `Ros` instance are not reused.

```typescript
// Simplified — see useRobot.ts for full implementation
let topic = topicCache.get(key);
if (!topic) {
  topic = new roslibModule.Topic({ ros: rosInstance, name, messageType });
  topicCache.set(key, topic);
}
topic.publish(data);
```

**Important**: Topics must be reused — creating a new `Topic` per call causes rosbridge to receive repeated `advertise` ops from different objects, which breaks subsequent publishes. The function is synchronous (uses the pre-loaded `roslibModule` directly, no `await`).

## Subscribing

### `useTopic(name, type, getRos, connected)` — state-based

Returns the latest message as React state. Every message triggers a re-render. Use for small/infrequent messages where the component needs to react to each update.

### `useTopicRef<T>(name, type, getRos, connected, onMessage?)` — ref-based

Returns a ref holding the latest message. No re-renders. Optional `onMessage` callback for side effects (e.g., rebuilding an offscreen canvas). Use for large or high-frequency messages where re-rendering would be expensive.

### `usePose(getRos, connected)` — specialized /tf

Subscribes to `/tf`, caches individual transform frames, and composes `map -> odom -> base_footprint` into a single `Pose2D` ref. Does not re-render.

## Connection Lifecycle

1. `connect(ip)` — loads roslib, creates a `Ros` instance with `ws://{ip}:9090`, registers event handlers
2. On close/error (unless intentional disconnect): `scheduleReconnect` with exponential backoff (3s initial, 1.5x growth, 30s max)
3. `disconnect()` — sets `intentionalDisconnect` flag, clears topic cache, closes the connection
4. Subscription hooks create their own `Topic` instances in `useEffect` and unsubscribe on cleanup/disconnect

## Critical: `getRos` Must Be Stable

`getRos` is passed to all subscription hooks and appears in their `useEffect` dependency arrays. It **must** be memoized with `useCallback` — an inline arrow function creates a new reference on every render, which triggers all subscriptions to teardown and re-subscribe. This floods rosbridge with subscribe/unsubscribe churn that can crash it and silently drop publish messages.

## roslib v2.1.0 Behaviors

- **Auto-advertise**: `Topic.publish()` calls `advertise()` internally if not yet advertised
- **`callOnConnection`**: Messages are queued if the connection isn't ready yet and sent once connected
- **`reconnect_on_close`**: Defaults to `true` on Topics — handles re-subscribing/re-advertising when the Ros connection is restored

## Topic Map

| Topic | Direction | Hook | Pattern | Data |
|-------|-----------|------|---------|------|
| `/cmd_vel` | publish | `useRobot.publish()` | cached Topic | `geometry_msgs/Twist` |
| `/scan` | subscribe | `useTopic` | state | `sensor_msgs/LaserScan` |
| `/map` | subscribe | `useTopicRef` | ref + callback | `nav_msgs/OccupancyGrid` |
| `/tf` | subscribe | `usePose` | ref + transform composition | `tf2_msgs/TFMessage` |
