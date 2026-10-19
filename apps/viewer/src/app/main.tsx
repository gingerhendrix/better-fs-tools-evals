import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { DataProvider } from "./data.tsx";
import { Overview } from "./Overview.tsx";
import { href, useRoute } from "./route.ts";
import { RunPage } from "./RunPage.tsx";
import { Runs } from "./Runs.tsx";
import { TaskPage } from "./TaskPage.tsx";
import { Tasks } from "./Tasks.tsx";

const PAGES = [
  ["overview", "Overview"],
  ["tasks", "Tasks"],
  ["runs", "Runs"],
] as const;

function App() {
  const route = useRoute();
  return (
    <>
      <header>
        <h1>Eval runs</h1>
        <nav>
          {PAGES.map(([page, label]) => (
            <a key={page} href={href(page)} className={route.page === page ? "active" : ""}>
              {label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        <DataProvider>
          {route.page === "tasks" && <Tasks route={route} />}
          {route.page === "task" && <TaskPage route={route} />}
          {route.page === "runs" && <Runs route={route} />}
          {route.page === "run" && <RunPage route={route} />}
          {!["tasks", "task", "runs", "run"].includes(route.page) && <Overview />}
        </DataProvider>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
