#!/usr/bin/env python3
import sys
import termios
import tty
import time
from roslibpy import Message, Ros, Topic


class RobotController:
    def __init__(self, robot_ip):
        # Connect to ROS
        self.ros = Ros(robot_ip, 9090)
        self.ros.run()

        # Create publisher for movement commands
        self.cmd_vel_pub = Topic(self.ros, "/cmd_vel", "geometry_msgs/Twist")

        # Movement settings
        self.speed = 0.5  # Linear velocity (m/s)
        self.turn = 0.6  # Angular velocity (rad/s)

        # Current state
        self.linear_x = 0
        self.angular_z = 0

    def get_key(self):
        """Get keyboard input"""
        fd = sys.stdin.fileno()
        old_settings = termios.tcgetattr(fd)
        try:
            tty.setraw(sys.stdin.fileno())
            ch = sys.stdin.read(1)
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
        return ch

    def publish_cmd(self):
        """Publish current movement command"""
        message = Message(
            {
                "linear": {"x": self.linear_x, "y": 0, "z": 0},
                "angular": {"x": 0, "y": 0, "z": self.angular_z},
            }
        )
        self.cmd_vel_pub.publish(message)

    def run(self):
        """Main control loop"""
        print("JetRacer Control:")
        print("w/s : forward/backward")
        print("a/d : turn left/right")
        print("space : stop")
        print("q : quit")

        try:
            while True:
                key = self.get_key()

                if key == "w":
                    self.linear_x = self.speed
                    self.angular_z = 0
                    print("Forward")
                elif key == "s":
                    self.linear_x = -self.speed
                    self.angular_z = 0
                    print("Backward")
                elif key == "a":
                    self.linear_x = 0
                    self.angular_z = self.turn
                    print("Left")
                elif key == "d":
                    self.linear_x = 0
                    self.angular_z = -self.turn
                    print("Right")
                elif key == " ":
                    self.linear_x = 0
                    self.angular_z = 0
                    print("Stop")
                elif key == "q":
                    break

                self.publish_cmd()

        except Exception as e:
            print(e)

        finally:
            # Make sure to stop the robot when shutting down
            self.linear_x = 0
            self.angular_z = 0
            self.publish_cmd()
            self.ros.terminate()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 control_jetracer.py <robot_ip>")
        sys.exit(1)

    robot_ip = sys.argv[1]
    controller = RobotController(robot_ip)
    controller.run()
