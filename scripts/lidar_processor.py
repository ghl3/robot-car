#!/usr/bin/env python3
import sys
import math
import numpy as np
import roslibpy


class LidarProcessor:
    def __init__(self, robot_ip):
        self.ros = roslibpy.Ros(host=robot_ip, port=9090)
        self.ros.on_ready(self.on_open)
        self.ros.on("close", self.on_close)
        self.listener = None
        self.points = []

    def on_open(self):
        print("Connected to ROS.")
        self.listener = roslibpy.Topic(self.ros, "/scan", "sensor_msgs/LaserScan")
        self.listener.subscribe(self.process_message)

    def on_close(self, _proto=None):
        print("Connection closed.")

    def process_message(self, msg):
        range_min = msg.get("range_min")
        range_max = msg.get("range_max")
        ranges = msg.get("ranges", [])
        angle_min = msg.get("angle_min", 0.0)
        angle_increment = msg.get("angle_increment", 0.0)

        # Ensure range_min and range_max are valid floats
        if not (isinstance(range_min, float) and isinstance(range_max, float)):
            print("Invalid range_min or range_max; skipping message.")
            return

        points = []
        angle = angle_min

        for r in ranges:
            # Skip any non-float, NaN, or None
            if isinstance(r, float) and range_min <= r <= range_max:
                x = r * math.cos(angle)
                y = r * math.sin(angle)
                points.append((x, y))
            angle += angle_increment

        if len(points) > 0:
            points = np.array(points)
            self.points = points
            print(f"\nProcessed {len(points)} points")
            self.detect_lines(points)

    def detect_lines(self, points, threshold=0.1):
        if len(points) < 2:
            return
        for _ in range(3):
            if len(points) < 10:
                break
            idx = np.random.choice(len(points), 2, replace=False)
            p1, p2 = points[idx]
            v = p2 - p1
            v /= np.linalg.norm(v)
            vp = points - p1
            dist = np.abs(np.cross(vp, v))
            inliers = points[dist < threshold]
            if len(inliers) > 10:
                length = np.linalg.norm(inliers[-1] - inliers[0])
                print(
                    f"Found potential wall: {len(inliers)} points, length: {length:.2f}m"
                )

    def run(self):
        self.ros.run_forever()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python lidar_processor.py <robot_ip>")
        sys.exit(1)

    robot_ip = sys.argv[1]
    processor = LidarProcessor(robot_ip)
    processor.run()
