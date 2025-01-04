#!/usr/bin/env python3
import sys
import tty
import termios
import time
from roslibpy import Message, Ros, Topic
import atexit


class RobotController:
    def __init__(self, robot_ip):
        # Store terminal settings and register cleanup
        self.fd = sys.stdin.fileno()
        self.old_settings = termios.tcgetattr(self.fd)
        atexit.register(self.cleanup)

        print("\nConnecting to JetRacer...")
        self.ros = Ros(robot_ip, 9090)
        self.ros.run()
        self.cmd_vel_pub = Topic(self.ros, "/cmd_vel", "geometry_msgs/Twist")
        print("Connected!")

        # Movement settings
        self.speed = 0.5  # Linear velocity (m/s)
        self.turn = 0.6  # Angular velocity (rad/s)
        self.turn_speed = 0.3  # Speed when turning in place

    def cleanup(self):
        """Reset everything to initial state"""
        print("\nCleaning up...")
        # Restore terminal
        termios.tcsetattr(self.fd, termios.TCSADRAIN, self.old_settings)
        # Stop robot
        if hasattr(self, "cmd_vel_pub"):
            msg = Message(
                {
                    "linear": {"x": 0, "y": 0, "z": 0},
                    "angular": {"x": 0, "y": 0, "z": 0},
                }
            )
            self.cmd_vel_pub.publish(msg)
        # Close ROS connection
        if hasattr(self, "ros"):
            self.ros.terminate()

    def getch(self):
        """Get a single character or arrow key from stdin"""
        try:
            tty.setraw(sys.stdin.fileno())
            ch = sys.stdin.read(1)
            if ch == "\x03":  # Ctrl+C
                raise KeyboardInterrupt
            if ch == "\x1b":  # Escape sequence
                ch2 = sys.stdin.read(1)
                ch3 = sys.stdin.read(1)
                if ch2 == "[":  # Arrow keys
                    return {
                        "A": "w",  # Up arrow
                        "B": "s",  # Down arrow
                        "C": "d",  # Right arrow
                        "D": "a",  # Left arrow
                    }.get(ch3, "")
            return ch
        finally:
            termios.tcsetattr(self.fd, termios.TCSADRAIN, self.old_settings)

    def show_controls(self):
        print("\n" + "=" * 40)
        print("JetRacer Controls")
        print("=" * 40)
        print(
            """
    W/↑ : Forward        Speed: {:.1f} m/s
    S/↓ : Backward
    A/← : Turn Left      Turn:  {:.1f} rad
    D/→ : Turn Right
    
    Space : Stop
    Q     : Quit
    Ctrl+C : Emergency Stop
        """.format(
                self.speed, self.turn
            )
        )
        print("=" * 40 + "\n")

    def send_command(self, linear_x, angular_z):
        """Send movement command and show status"""
        msg = Message(
            {
                "linear": {"x": linear_x, "y": 0, "z": 0},
                "angular": {"x": 0, "y": 0, "z": angular_z},
            }
        )
        self.cmd_vel_pub.publish(msg)
        status = f"\rSpeed: {linear_x:+.2f} m/s | Turn: {angular_z:+.2f} rad"
        if linear_x == 0 and angular_z == 0:
            status += " | STOPPED"
        print(status, end="", flush=True)

    def run(self):
        self.show_controls()

        try:
            while True:
                key = self.getch().lower()

                # Base movement commands
                linear_x = 0.0
                angular_z = 0.0

                if key == "q":
                    break
                elif key in ["w"]:  # Forward
                    linear_x = self.speed
                elif key in ["s"]:  # Backward
                    linear_x = -self.speed
                elif key in ["a"]:  # Turn Left
                    angular_z = self.turn
                    linear_x = self.turn_speed  # Add some forward motion for turning
                elif key in ["d"]:  # Turn Right
                    angular_z = -self.turn
                    linear_x = self.turn_speed  # Add some forward motion for turning
                elif key == " ":  # Stop
                    linear_x = 0
                    angular_z = 0

                self.send_command(linear_x, angular_z)

        except KeyboardInterrupt:
            print("\nEmergency stop initiated...")
        finally:
            self.cleanup()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 control_jetracer.py <robot_ip>")
        sys.exit(1)

    controller = RobotController(sys.argv[1])
    controller.run()
