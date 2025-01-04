import React from "react";
import LidarViewer from "./components/LidarViewer";

function App() {
  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <h1>JetRacer LIDAR Viewer</h1>
      <LidarViewer />
    </div>
  );
}

export default App;
