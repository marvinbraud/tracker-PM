import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router, Route, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "./components/ui/toaster";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import OverviewPage from "./pages/OverviewPage";
import PositionsPage from "./pages/PositionsPage";
import RiskPage from "./pages/RiskPage";
import ChartsPage from "./pages/ChartsPage";
import ImportPage from "./pages/ImportPage";
import MacroPage from "./pages/MacroPage";
import GoalsPage from "./pages/GoalsPage";

export type Theme = "dark" | "light";

export default function App() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [portfolio, setPortfolio] = useState<string>("Global");
  const [period, setPeriod] = useState<string>("1Y");
  const [benchmark, setBenchmark] = useState<string>("SPY");

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  return (
    <QueryClientProvider client={queryClient}>
      <div className={theme} style={{ height: "100dvh", overflow: "hidden" }}>
        <div className="dashboard-grid">
          <Router hook={useHashLocation}>
            <Sidebar portfolio={portfolio} setPortfolio={setPortfolio} />
            <Topbar
              theme={theme} toggleTheme={toggleTheme}
              period={period} setPeriod={setPeriod}
              benchmark={benchmark} setBenchmark={setBenchmark}
              portfolio={portfolio}
            />
            <main className="main-content">
              <Switch>
                <Route path="/" component={() =>
                  <OverviewPage portfolio={portfolio} period={period} benchmark={benchmark} />
                } />
                <Route path="/positions" component={() =>
                  <PositionsPage portfolio={portfolio} period={period} benchmark={benchmark} />
                } />
                <Route path="/charts" component={() =>
                  <ChartsPage portfolio={portfolio} period={period} benchmark={benchmark} />
                } />
                <Route path="/risk" component={() =>
                  <RiskPage portfolio={portfolio} period={period} benchmark={benchmark} />
                } />
                <Route path="/import" component={() =>
                  <ImportPage portfolio={portfolio} setPortfolio={setPortfolio} />
                } />
                <Route path="/macro" component={() => <MacroPage />} />
                <Route path="/goals" component={() =>
                  <GoalsPage portfolio={portfolio} />
                } />
              </Switch>
            </main>
          </Router>
        </div>
        <Toaster />
      </div>
    </QueryClientProvider>
  );
}
