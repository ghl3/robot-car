import React, { useEffect, useRef, useState } from "react";
import ROSLIB from "roslib";

const LidarViewer = () => {
  const canvasRef = useRef(null);
  const [status, setStatus] = useState("Initializing...");
  const [ros, setRos] = useState(null);
  const [lastScan, setLastScan] = useState(null);
  const [persistentPoints, setPersistentPoints] = useState([]); // Store points across scans

  useEffect(() => {
    const ros = new ROSLIB.Ros({
      url: "ws://192.168.7.107:9090",
    });

    ros.on("connection", () => {
      setStatus("Connected to ROS");
      setRos(ros);
    });

    ros.on("error", (error) => {
      setStatus("Error connecting to ROS");
      console.error("ROS connection error:", error);
    });

    ros.on("close", () => {
      setStatus("Connection closed");
    });

    return () => {
      if (ros) {
        ros.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!ros) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const scale = 20; // pixels per meter

    const listener = new ROSLIB.Topic({
      ros: ros,
      name: "/scan",
      messageType: "sensor_msgs/LaserScan",
    });

    function drawScan(scan) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw background grid
      ctx.strokeStyle = "#eee";
      ctx.beginPath();
      for (let i = 0; i <= canvas.width; i += scale) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
      }
      ctx.stroke();

      // Draw circles for distance reference
      ctx.strokeStyle = "#ccc";
      for (let r = 1; r <= 5; r++) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, r * scale, 0, 2 * Math.PI);
        ctx.stroke();
      }

      // Draw LIDAR points
      ctx.fillStyle = "rgba(255, 0, 0, 0.7)";
      const angleMin = scan.angle_min;
      const angleIncrement = scan.angle_increment;

      const newPoints = []; // Collect points from this scan
      scan.ranges.forEach((range, i) => {
        if (range >= scan.range_min && range <= scan.range_max) {
          const angle = angleMin + angleIncrement * i;
          const x = centerX + Math.cos(angle) * range * scale;
          const y = centerY + Math.sin(angle) * range * scale;

          ctx.beginPath();
          ctx.arc(x, y, 2, 0, 2 * Math.PI);
          ctx.fill();

          newPoints.push({ x, y });
        }
      });

      // Draw persistent points in a different color
      ctx.fillStyle = "rgba(0, 0, 255, 0.3)";
      persistentPoints.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2, 0, 2 * Math.PI);
        ctx.fill();
      });

      // Update persistent points
      setPersistentPoints((prevPoints) => {
        const combinedPoints = [...prevPoints, ...newPoints];
        // Limit the number of stored points to prevent overwhelming the browser
        return combinedPoints.slice(-1000);
      });

      setLastScan(scan);
    }

    listener.subscribe((message) => {
      drawScan(message);
    });

    return () => {
      if (listener) {
        listener.unsubscribe();
      }
    };
  }, [ros]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "20px",
      }}
    >
      <h2>LIDAR Visualization</h2>
      <div
        style={{
          color: status.includes("Error")
            ? "red"
            : status.includes("Connected")
            ? "green"
            : "blue",
          marginBottom: "10px",
        }}
      >
        {status}
      </div>
      <canvas
        ref={canvasRef}
        width={600}
        height={600}
        style={{ border: "1px solid #ccc" }}
      />
      <div style={{ marginTop: "10px", fontSize: "12px" }}>
        Grid squares = 1 meter | Red = Current scan | Blue = Previous scans
      </div>
      {lastScan && (
        <div
          style={{
            marginTop: "10px",
            fontSize: "12px",
            maxWidth: "600px",
            textAlign: "left",
          }}
        >
          <pre>
            Scan info: Min angle:{" "}
            {((lastScan.angle_min * 180) / Math.PI).toFixed(2)}° Max angle:{" "}
            {((lastScan.angle_max * 180) / Math.PI).toFixed(2)}° Min range:{" "}
            {lastScan.range_min.toFixed(2)}m Max range:{" "}
            {lastScan.range_max.toFixed(2)}m Points: {lastScan.ranges.length}
          </pre>
        </div>
      )}
    </div>
  );
};

export default LidarViewer;
