import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { App } from "./App";
import { ApplicationErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

const Router = window.location.protocol === "file:" ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ApplicationErrorBoundary>
      <Router>
        <App />
      </Router>
    </ApplicationErrorBoundary>
  </React.StrictMode>,
);
