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

`publish()` creates a transient `Topic` object and calls `topic.publish(data)`. roslib auto-advertises internally via `callOnConnection()`, so no manual `advertise()` call or caching is needed. Creating a new `Topic` per call is intentional — it's a lightweight JS wrapper, not a network resource.

```typescript
const topic = new roslib.Topic({ ros, name: topicName, messageType });
topic.publish(data);
```

## Subscribing

### `useTopic(name, type, getRos, connected)` — state-based

Returns the latest message as React state. Every message triggers a re-render. Use for small/infrequent messages where the component needs to react to each update.

### `useTopicRef<T>(name, type, getRos, connected, onMessage?)` — ref-based

Returns a ref holding the latest message. No re-renders. Optional `onMessage` callback for side effects (e.g., rebuilding an offscreen canvas). Use for large or high-frequency messages where re-rendering would be expensive.

### `usePose(getRos, connected)` — specialized /tf

Subscribes to `/tf`, caches individual transform frames, and composes `map -> odom -> base_footprint` into a single `Pose2D` ref. Does not re-render.

## Connection Lifecycle

1. `connect(ip)` — creates a `Ros` instance with `ws://{ip}:9090`, registers event handlers
2. On close/error (unless intentional disconnect): `scheduleReconnect` with exponential backoff (3s initial, 1.5x growth, 30s max)
3. `disconnect()` — sets `intentionalDisconnect` flag, closes the connection
4. Subscription hooks create their own `Topic` instances in `useEffect` and unsubscribe on cleanup/disconnect

## roslib v2.1.0 Behaviors

- **Auto-advertise**: `Topic.publish()` calls `advertise()` internally if not yet advertised
- **`callOnConnection`**: Messages are queued if the connection isn't ready yet and sent once connected
- **`reconnect_on_close`**: Defaults to `true` in roslib — our manual reconnection handles this instead

## Topic Map

| Topic | Direction | Hook | Pattern | Data |
|-------|-----------|------|---------|------|
| `/cmd_vel` | publish | `useRobot.publish()` | transient Topic | `geometry_msgs/Twist` |
| `/scan` | subscribe | `useTopic` | state | `sensor_msgs/LaserScan` |
| `/map` | subscribe | `useTopicRef` | ref + callback | `nav_msgs/OccupancyGrid` |
| `/tf` | subscribe | `usePose` | ref + transform composition | `tf2_msgs/TFMessage` |
