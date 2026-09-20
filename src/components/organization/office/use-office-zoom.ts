"use client";

import { useLayoutEffect, useRef, useState } from "react";

export function useOfficeZoom(minimumWidth: number) {
  const viewport = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 960, height: 0 });
  const [manual, setManual] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const width = viewport.current?.clientWidth || 960;
      const height = scene.current?.offsetHeight || 0;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (viewport.current) observer?.observe(viewport.current);
    if (scene.current) observer?.observe(scene.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const fit = Math.max(5, Math.min(100, Math.floor(size.width / minimumWidth * 100)));
  const percent = manual ?? fit;
  const scale = percent / 100;
  const width = Math.max(minimumWidth, size.width / scale);
  return { viewport, scene, percent, scale, width, height: size.height * scale, automatic: manual === null,
    zoom: (value: number) => setManual(Math.max(5, Math.min(150, value))), fit: () => setManual(null) };
}
