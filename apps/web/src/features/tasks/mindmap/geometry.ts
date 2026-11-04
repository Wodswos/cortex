import { useEffect, useMemo } from 'react';
import { useStore, useStoreApi, useUpdateNodeInternals, type ReactFlowState } from '@xyflow/react';

const invalidHandle = (handle: { x: number; y: number }) => !Number.isFinite(handle.x) || !Number.isFinite(handle.y);

function pendingGeometry(state: Pick<ReactFlowState, 'nodeLookup'>): string[] {
  const pending: string[] = [];
  for (const node of state.nodeLookup.values()) {
    if (node.hidden) continue;
    const handles = node.internals.handleBounds;
    if (!node.measured.width || !node.measured.height ||
      !handles?.source?.length || !handles.target?.length ||
      handles.source.some(invalidHandle) || handles.target.some(invalidHandle)) pending.push(node.id);
  }
  return pending;
}

/** Missing handles break both edge rendering and React Flow's rectangle hit testing.
 * Initialize them independently of the first ResizeObserver notification, which can
 * be delayed or skipped while a view is hidden. Repair only incomplete nodes.
 */
export function useMindGeometry() {
  const store = useStoreApi();
  const updateNodeInternals = useUpdateNodeInternals();
  const selector = useMemo(() => {
    let nodes: ReactFlowState['nodes'] | undefined;
    let count = -1;
    let missing = '';
    return (state: ReactFlowState) => {
      // Once complete, geometry stays valid until nodes change. Viewport updates
      // need no full-graph scan. Incomplete nodes still retry after internals-only
      // updates; focus/resize below always check the live handles independently.
      if (missing === '[]' && nodes === state.nodes && count === state.nodeLookup.size) return missing;
      nodes = state.nodes; count = state.nodeLookup.size;
      missing = JSON.stringify(pendingGeometry(state));
      return missing;
    };
  }, []);
  const missing = useStore(selector);
  const element = useStore((state) => state.domNode);
  useEffect(() => {
    if (!element) return;
    const initialize = () => {
      if (document.visibilityState === 'hidden' || !element.isConnected || !element.clientWidth || !element.clientHeight) return;
      const ids = pendingGeometry(store.getState());
      if (ids.length) updateNodeInternals(ids);
    };
    initialize();
    const observer = new ResizeObserver(initialize);
    observer.observe(element);
    document.addEventListener('visibilitychange', initialize);
    window.addEventListener('pageshow', initialize);
    window.addEventListener('focus', initialize);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', initialize);
      window.removeEventListener('pageshow', initialize);
      window.removeEventListener('focus', initialize);
    };
  }, [missing, element, store, updateNodeInternals]);
}
