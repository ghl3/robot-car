import { NextResponse } from "next/server";
import { executeCommand } from "@/lib/ssh";

const ROS_ENV = "source /opt/ros/melodic/setup.bash && source ~/catkin_ws/devel/setup.bash";

const COMPONENT_COMMANDS: Record<string, { kill: string; start: string }> = {
  camera: {
    kill: "pkill -f gscam 2>/dev/null; sleep 1; pkill -9 -f gscam 2>/dev/null",
    start: `${ROS_ENV} && nohup roslaunch jetracer csi_camera.launch > /tmp/restart_camera.log 2>&1 &`,
  },
  web_video_server: {
    kill: "pkill -f web_video_server 2>/dev/null; sleep 1; pkill -9 -f web_video_server 2>/dev/null",
    start: `${ROS_ENV} && nohup rosrun web_video_server web_video_server > /tmp/restart_wvs.log 2>&1 &`,
  },
  rosbridge: {
    kill: "pkill -f rosbridge 2>/dev/null; sleep 1; pkill -9 -f rosbridge 2>/dev/null",
    start: `${ROS_ENV} && nohup roslaunch rosbridge_server rosbridge_websocket.launch > /tmp/restart_rosbridge.log 2>&1 &`,
  },
  lidar: {
    kill: "pkill -f rplidarNode 2>/dev/null; sleep 1; pkill -9 -f rplidarNode 2>/dev/null",
    start: `${ROS_ENV} && chmod 666 /dev/ttyACM1 2>/dev/null; nohup roslaunch jetracer lidar.launch > /tmp/restart_lidar.log 2>&1 &`,
  },
  slam: {
    kill: "pkill -f slam_gmapping 2>/dev/null; sleep 1; pkill -9 -f slam_gmapping 2>/dev/null",
    start: `${ROS_ENV} && nohup rosrun gmapping slam_gmapping _base_frame:=base_footprint _odom_frame:=odom _map_update_interval:=1.0 _maxUrange:=6.0 _maxRange:=8.0 _particles:=80 _linearUpdate:=0.15 _angularUpdate:=0.25 _temporalUpdate:=3.0 _delta:=0.05 _xmin:=-15.0 _xmax:=15.0 _ymin:=-15.0 _ymax:=15.0 _minimumScore:=200 _srr:=0.1 _srt:=0.2 _str:=0.1 _stt:=0.2 _iterations:=5 _lstep:=0.05 _astep:=0.05 > /tmp/restart_slam.log 2>&1 &`,
  },
  jetracer: {
    kill: "pkill -f 'jetracer.launch' 2>/dev/null; sleep 1; pkill -9 -f 'jetracer.launch' 2>/dev/null",
    start: `${ROS_ENV} && nohup roslaunch jetracer jetracer.launch > /tmp/restart_jetracer.log 2>&1 &`,
  },
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ip, username, password, component } = body;

    if (!ip) {
      return NextResponse.json({ success: false, message: "IP address is required" }, { status: 400 });
    }

    const cmds = COMPONENT_COMMANDS[component];
    if (!cmds) {
      return NextResponse.json(
        { success: false, message: `Unknown component: ${component}. Valid: ${Object.keys(COMPONENT_COMMANDS).join(", ")}` },
        { status: 400 }
      );
    }

    const creds = { username, password };

    // Kill existing process
    await executeCommand(ip, cmds.kill, creds);

    // Start new process
    const startResult = await executeCommand(ip, cmds.start, creds);

    return NextResponse.json({
      success: true,
      component,
      message: `${component} restarted`,
      stdout: startResult.stdout,
      stderr: startResult.stderr,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: (error as Error).message },
      { status: 500 }
    );
  }
}
