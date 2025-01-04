#!/usr/bin/env python3
import sys
import termios
import tty
import time
import select
import signal
from roslibpy import Message, Ros, Topic


class RobotController:
    def __init__(self, robot_ip):
        # Store original terminal settings immediately
        self.original_settings = termios.tcgetattr(sys.stdin)

        print("\nConnecting to JetRacer...")
        self.ros = Ros(robot_ip, 9090)
        self.ros.run()

        # Create publisher for movement commands
        self.cmd_vel_pub = Topic(self.ros, "/cmd_vel", "geometry_msgs/Twist")

        # Movement settings
        self.speed = 0.5  # Linear velocity (m/s)
        self.turn = 0.6  # Angular velocity (rad/s)
        self.turn_speed = 0.3  # Speed to use while turning

        # Current state
        self.linear_x = 0
        self.angular_z = 0

        # Flag to indicate if we're shutting down
        self.shutting_down = False

        # Set up signal handlers
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

    def print_controls(self):
        """Display control instructions"""
        print("\n" + "=" * 40)
        print("JetRacer Controls")
        print("=" * 40)
        print(
            """
Controls:
    W/↑ : Forward        Speed: {:.1f} m/s
    S/↓ : Backward
    A/← : Turn Left      Turn:  {:.1f} rad
    D/→ : Turn Right
    
    Space : Stop
    Q     : Quit
        """.format(
                self.speed, self.turn
            )
        )
        print("=" * 40 + "\n")

    def restore_terminal(self):
        """Restore terminal to original state"""
        if hasattr(self, "original_settings"):
            try:
                termios.tcsetattr(sys.stdin, termios.TCSADRAIN, self.original_settings)
            except:
                pass

    def print_status(self):
        """Print current status"""
        status = f"\rSpeed: {self.linear_x:+.2f} m/s | Turn: {self.angular_z:+.2f} rad"
        if self.linear_x == 0 and self.angular_z == 0:
            status += " | STOPPED"
        print(status, end="", flush=True)

    def signal_handler(self, signum, frame):
        """Handle Ctrl+C and other termination signals"""
        if self.shutting_down:  # Prevent multiple shutdown attempts
            return

        self.shutting_down = True
        print("\n\nStopping robot...")

        # Restore terminal first
        self.restore_terminal()

        # Then stop the robot
        self.emergency_stop()
        sys.exit(0)

    def emergency_stop(self):
        """Ensure the robot stops"""
        try:
            # Send multiple stop commands to ensure they're received
            for _ in range(3):
                message = Message(
                    {
                        "linear": {"x": 0, "y": 0, "z": 0},
                        "angular": {"x": 0, "y": 0, "z": 0},
                    }
                )
                self.cmd_vel_pub.publish(message)
                time.sleep(0.1)

            if hasattr(self, "ros") and self.ros:
                self.ros.terminate()
        except:
            pass

    def get_key(self):
        """Get keyboard input with timeout, including special keys"""
        dr, dw, de = select.select([sys.stdin], [], [], 0.1)
        if not dr:
            return None

        c = sys.stdin.read(1)
        if c == "\x1b":  # Escape sequence
            dr, dw, de = select.select([sys.stdin], [], [], 0.0001)
            if dr:
                c2 = sys.stdin.read(1)
                dr, dw, de = select.select([sys.stdin], [], [], 0.0001)
                if dr:
                    c3 = sys.stdin.read(1)
                    if c2 == "[":  # Escape sequence for arrow keys
                        return {"A": "UP", "B": "DOWN", "C": "RIGHT", "D": "LEFT"}.get(
                            c3
                        )
        return c

    def publish_cmd(self):
        """Publish current movement command"""
        message = Message(
            {
                "linear": {"x": self.linear_x, "y": 0, "z": 0},
                "angular": {"x": 0, "y": 0, "z": self.angular_z},
            }
        )
        self.cmd_vel_pub.publish(message)
        self.print_status()

    def run(self):
        """Main control loop"""
        self.print_controls()

        try:
            # Enter raw mode
            tty.setraw(sys.stdin.fileno())

            keys_pressed = set()
            while not self.shutting_down:
                try:
                    key = self.get_key()

                    if key is not None:
                        if key == "q":
                            break
                        elif key == " ":
                            keys_pressed.clear()
                        else:
                            # Map arrow keys to WASD
                            key_mapping = {
                                "UP": "w",
                                "DOWN": "s",
                                "LEFT": "a",
                                "RIGHT": "d",
                            }
                            mapped_key = key_mapping.get(key, key)
                            if mapped_key in "wasd":
                                keys_pressed.add(mapped_key)

                    # Process movement commands
                    self.linear_x = 0
                    self.angular_z = 0

                    if "w" in keys_pressed or "UP" in keys_pressed:
                        self.linear_x = self.speed
                    elif "s" in keys_pressed or "DOWN" in keys_pressed:
                        self.linear_x = -self.speed

                    if "a" in keys_pressed or "LEFT" in keys_pressed:
                        self.angular_z = self.turn
                        if self.linear_x == 0:
                            self.linear_x = self.turn_speed
                    elif "d" in keys_pressed or "RIGHT" in keys_pressed:
                        self.angular_z = -self.turn
                        if self.linear_x == 0:
                            self.linear_x = self.turn_speed

                    keys_pressed = {k for k in keys_pressed if k in "wasd"}

                    self.publish_cmd()
                    time.sleep(0.1)

                except select.error:
                    # Handle interrupted system call (happens during Ctrl+C)
                    if self.shutting_down:
                        break
                    continue

        except Exception as e:
            print(f"\n\nError: {e}")

        finally:
            # Always restore terminal and stop robot
            self.restore_terminal()
            self.emergency_stop()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 control_jetracer.py <robot_ip>")
        sys.exit(1)

    robot_ip = sys.argv[1]
    controller = RobotController(robot_ip)
    controller.run()
