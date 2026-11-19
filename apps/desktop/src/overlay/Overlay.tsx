import type { CSSProperties } from "react";
import { BatteryGridWidget, BatteryRingWidget } from "../widgets/BatteryWidgets";
import { CalendarWidget } from "../widgets/CalendarWidget";
import { ClockWidget } from "../widgets/ClockWidget";
import { DateCircleWidget } from "../widgets/DateCircleWidget";
import { DiskWidget, RamWidget } from "../widgets/SystemWidgets";
import { WeatherWidget } from "../widgets/WeatherWidget";
import type { Layout, Placement } from "./layout";
import "./Overlay.css";

function renderWidget(p: Placement) {
  switch (p.kind) {
    case "clock":
      return <ClockWidget config={p.config} />;
    case "date-circle":
      return <DateCircleWidget />;
    case "calendar":
      return <CalendarWidget />;
    case "battery-ring":
      return <BatteryRingWidget />;
    case "battery-grid":
      return <BatteryGridWidget />;
    case "ram":
      return <RamWidget />;
    case "disk":
      return <DiskWidget />;
    case "weather":
      return <WeatherWidget />;
  }
}

/** The desktop layer: widgets placed on the cell grid over the wallpaper. */
export function Overlay({ layout }: { readonly layout: Layout }) {
  return (
    <main className="overlay">
      {layout.placements.map((p) => (
        <div key={p.id} className="overlay__slot" style={{ "--x": p.x, "--y": p.y } as CSSProperties}>
          {renderWidget(p)}
        </div>
      ))}
    </main>
  );
}
