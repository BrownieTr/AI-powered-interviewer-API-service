import { useEffect, useState } from "react";
import "./App.css";

const apiBase =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "http://localhost:3001";

function App() {
  const [apiStatus, setApiStatus] = useState<"checking" | "ok" | "error">(
    "checking"
  );

  useEffect(() => {
    fetch(`${apiBase}/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((body) => {
        setApiStatus(body?.ok ? "ok" : "error");
      })
      .catch(() => setApiStatus("error"));
  }, []);

  return (
    <>
      <h1>Classroom API client</h1>
      <p>
        API ({apiBase}):{" "}
        {apiStatus === "checking" && "…"}
        {apiStatus === "ok" && "connected"}
        {apiStatus === "error" && "unreachable — start the server with npm run dev in server/"}
      </p>
    </>
  );
}

export default App
