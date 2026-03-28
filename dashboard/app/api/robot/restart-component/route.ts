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
  scan_filter: {
    kill: "pkill -f scan_to_scan_filter_chain 2>/dev/null; sleep 1; pkill -9 -f scan_to_scan_filter_chain 2>/dev/null",
    start: `${ROS_ENV} && rosparam load /tmp/laser_filter.yaml /scan_to_scan_filter_chain && nohup rosrun laser_filters scan_to_scan_filter_chain scan:=scan scan_filtered:=scan_filtered > /tmp/restart_scan_filter.log 2>&1 &`,
  },
  slam: {
    kill: "pkill -f slam_toolbox 2>/dev/null; sleep 1; pkill -9 -f slam_toolbox 2>/dev/null",
    start: `${ROS_ENV} && rosparam load /tmp/slam_toolbox_params.yaml /slam_toolbox && nohup rosrun slam_toolbox async_slam_toolbox_node scan:=scan_filtered > /tmp/restart_slam.log 2>&1 &`,
  },
  nav: {
    kill: "pkill -f 'move_base' 2>/dev/null; sleep 1; pkill -9 -f 'move_base' 2>/dev/null",
    start: `${ROS_ENV} && rosparam load /tmp/nav/nav_move_base.yaml /move_base && rosparam load /tmp/nav/nav_costmap_common.yaml /move_base/global_costmap && rosparam load /tmp/nav/nav_costmap_common.yaml /move_base/local_costmap && rosparam load /tmp/nav/nav_local_costmap.yaml /move_base && rosparam load /tmp/nav/nav_global_costmap.yaml /move_base && rosparam load /tmp/nav/nav_teb_planner.yaml /move_base && nohup rosrun move_base move_base > /tmp/restart_nav.log 2>&1 &`,
  },
  detectnet: {
    kill: "pkill -f 'ros_deep_learning/detectnet' 2>/dev/null; pkill -f 'relay./csi_cam_0/image_raw./detectnet' 2>/dev/null; sleep 1; pkill -9 -f 'ros_deep_learning/detectnet' 2>/dev/null",
    start: `${ROS_ENV} && nohup rosrun topic_tools relay /csi_cam_0/image_raw /detectnet/image_in > /dev/null 2>&1 & nohup rosrun ros_deep_learning detectnet _model_name:=ssd-mobilenet-v2 > /tmp/restart_detectnet.log 2>&1 &`,
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

    // Start new process — run without PTY so nohup'd background processes survive SSH disconnect
    const ssh = await (await import("@/lib/ssh")).getSSHConnection(ip, creds);
    try {
      await ssh.execCommand(cmds.start);
      // Brief wait for process to start
      await new Promise(r => setTimeout(r, 1500));
      ssh.dispose();
    } catch {
      ssh.dispose();
    }

    return NextResponse.json({
      success: true,
      component,
      message: `${component} restarted`,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: (error as Error).message },
      { status: 500 }
    );
  }
}
