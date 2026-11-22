import { useEffect, useState } from "react";
import { getNativeApi, type AppInfo } from "../lib/native/api";

/** Version, build and data folder from the core; null in a plain browser or until the core answers. */
export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const native = getNativeApi();
    if (native.available) {
      native.app.info().then(
        (next) => alive && setInfo(next),
        () => alive && setInfo(null),
      );
    }
    return () => {
      alive = false;
    };
  }, []);
  return info;
}
