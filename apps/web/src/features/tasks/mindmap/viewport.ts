import { useCallback, useEffect, useRef } from 'react';
import { useNodesInitialized, useReactFlow, type Node, type Viewport } from '@xyflow/react';
import type { MindNodeData } from './TaskNode';

export interface MapPosition { centerX: number; centerY: number; zoom: number }
export const mapPositionKey = (userId: string, root: string | null) => `cortex:mindmap-position:v1:${encodeURIComponent(userId)}:${encodeURIComponent(root ?? '__all__')}`;
export function readMapPosition(userId: string, root: string | null): MapPosition | null {
  try {
    const value = JSON.parse(localStorage.getItem(mapPositionKey(userId, root)) ?? 'null');
    return value && ['centerX', 'centerY', 'zoom'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key])) &&
      Math.abs(value.centerX) <= 1e7 && Math.abs(value.centerY) <= 1e7 && value.zoom >= 0.12 && value.zoom <= 2
      ? { centerX: value.centerX, centerY: value.centerY, zoom: value.zoom } : null;
  } catch { return null; }
}
export function rememberMapPosition(userId: string, root: string | null, value: MapPosition): void {
  try { localStorage.setItem(mapPositionKey(userId, root), JSON.stringify(value)); } catch { /* Camera state must never block task edits. */ }
}
export function initialMapPosition(bounds: { x: number; y: number; width: number; height: number }, width: number, height: number): MapPosition {
  const fit = Math.min((width - 64) / Math.max(1, bounds.width), (height - 64) / Math.max(1, bounds.height));
  return fit >= 0.85
    ? { centerX: bounds.x + bounds.width / 2, centerY: bounds.y + bounds.height / 2, zoom: Math.min(1.05, fit) }
    : { centerX: 0, centerY: 0, zoom: width < 600 ? 0.9 : 1 };
}
export const positionToViewport = (position: MapPosition, width: number, height: number): Viewport => ({
  x: width / 2 - position.centerX * position.zoom, y: height / 2 - position.centerY * position.zoom, zoom: position.zoom,
});

/** A camera belongs to an account and a diagram, independently of work highlighting. */
export function useMapViewport(userId: string, root: string | null, nodes: Node<MindNodeData>[], wrapper: React.RefObject<HTMLDivElement>) {
  const { getViewport, setViewport } = useReactFlow();
  const measured = useNodesInitialized();
  const initialized = useRef(false);
  const latest = useRef(nodes); latest.current = nodes;
  const lastPosition = useRef<MapPosition | null>(null);
  const dimensions = useRef({ width: 0, height: 0 });
  const capture = useCallback((viewport: Viewport) => {
    const element = wrapper.current;
    if (!element || !initialized.current) return;
    lastPosition.current = { centerX: (element.clientWidth / 2 - viewport.x) / viewport.zoom, centerY: (element.clientHeight / 2 - viewport.y) / viewport.zoom, zoom: viewport.zoom };
  }, [wrapper]);
  const save = useCallback(() => { if (initialized.current && lastPosition.current) rememberMapPosition(userId, root, lastPosition.current); }, [userId, root]);
  useEffect(() => {
    if (!measured || !nodes.length || initialized.current) return;
    let cancelled = false;
    let secondFrame = 0;
    const frame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => {
      const element = wrapper.current;
      if (!element || cancelled || !element.clientWidth || !element.clientHeight) return;
      const list = latest.current;
      const x = Math.min(...list.map((node) => node.position.x)), y = Math.min(...list.map((node) => node.position.y));
      const right = Math.max(...list.map((node) => node.position.x + (node.measured?.width ?? node.data.metrics.width)));
      const bottom = Math.max(...list.map((node) => node.position.y + (node.measured?.height ?? node.data.metrics.height)));
      const bounds = { x, y, width: right - x, height: bottom - y };
      const saved = readMapPosition(userId, root);
      const intersects = saved && saved.centerX + element.clientWidth / saved.zoom / 2 > x && saved.centerX - element.clientWidth / saved.zoom / 2 < right && saved.centerY + element.clientHeight / saved.zoom / 2 > y && saved.centerY - element.clientHeight / saved.zoom / 2 < bottom;
      const position = intersects ? saved : initialMapPosition(bounds, element.clientWidth, element.clientHeight);
      lastPosition.current = position;
      void setViewport(positionToViewport(position, element.clientWidth, element.clientHeight), { duration: 0 }).then(() => {
        if (!cancelled) { initialized.current = true; save(); }
      });
    }); });
    return () => { cancelled = true; cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame); };
  }, [measured, nodes.length, userId, root, setViewport, wrapper, save]);
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = dimensions.current;
      const next = { width: element.clientWidth, height: element.clientHeight };
      dimensions.current = next;
      if (!initialized.current || !width || !height || !next.width || !next.height || width === next.width && height === next.height) return;
      const viewport = getViewport();
      const position = { centerX: (width / 2 - viewport.x) / viewport.zoom, centerY: (height / 2 - viewport.y) / viewport.zoom, zoom: viewport.zoom };
      lastPosition.current = position;
      void setViewport(positionToViewport(position, next.width, next.height), { duration: 0 });
    });
    observer.observe(element);
    const hide = () => { capture(getViewport()); save(); };
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', hide);
    return () => { observer.disconnect(); save(); window.removeEventListener('pagehide', hide); document.removeEventListener('visibilitychange', hide); };
  }, [getViewport, setViewport, wrapper, capture, save]);
  const onMove = useCallback((_event: unknown, viewport: Viewport) => capture(viewport), [capture]);
  const onMoveEnd = useCallback((_event: unknown, viewport: Viewport) => { capture(viewport); save(); }, [capture, save]);
  const rootPosition = useCallback(() => {
    const element = wrapper.current;
    if (element) void setViewport(positionToViewport({ centerX: 0, centerY: 0, zoom: element.clientWidth < 600 ? 0.9 : 1 }, element.clientWidth, element.clientHeight), { duration: 180 });
  }, [wrapper, setViewport]);
  return {
    onMove,
    onMoveEnd,
    rootPosition,
  };
}
