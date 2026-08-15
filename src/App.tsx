import { useEffect } from "react";
import { MapView } from "./components/MapView";
import { TopBar } from "./components/TopBar";
import { FiltersPanel } from "./components/FiltersPanel";
import { StatsPanel } from "./components/StatsPanel";
import { EditsPanel } from "./components/EditsPanel";
import { DetailSheet } from "./components/DetailSheet";
import { ImportReportPanel } from "./components/ImportReportPanel";
import { Loader, MobileDock, Toast } from "./components/Chrome";
import { useApp } from "./store";
import { applyDocumentTheme } from "./lib/theme";

export default function App() {
  const init = useApp((s) => s.init);
  const uiTheme = useApp((s) => s.uiTheme);

  useEffect(() => {
    init().catch((e) => {
      console.error(e);
      useApp.getState().showToast("Eroare la încărcare");
    });
  }, [init]);

  useEffect(() => {
    applyDocumentTheme(uiTheme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => useApp.getState().syncSystemTheme();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [uiTheme]);

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden />
      <MapView />
      <TopBar />
      <FiltersPanel />
      <StatsPanel />
      <EditsPanel />
      <ImportReportPanel />
      <DetailSheet />
      <MobileDock />
      <Toast />
      <Loader />
    </div>
  );
}
