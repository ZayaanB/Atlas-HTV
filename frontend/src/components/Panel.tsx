import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { useWorkspace } from "../app/state";

export function Panel({
  title,
  children,
  viewKey,
}: {
  title: string;
  children: ReactNode;
  viewKey: string;
}) {
  const {
    panel,
    panelHistory,
    backPanel,
    closePanel,
    sheetExpanded,
    setSheetExpanded,
  } = useWorkspace();
  const root = useRef<HTMLElement>(null),
    body = useRef<HTMLDivElement>(null),
    positions = useRef(new Map<string, number>());
  const [mobile, setMobile] = useState(
    () =>
      typeof matchMedia === "function" &&
      matchMedia("(max-width:1199px)").matches,
  );
  const lastTrigger = useRef<HTMLElement | null>(null);
  const open = !!panel,
    previousOpen = useRef(false),
    touchStart = useRef<number | null>(null),
    dragged = useRef(false);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia("(max-width:1199px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const node = body.current;
    if (!node) return;
    node.scrollTop = positions.current.get(viewKey) ?? 0;
    return () => {
      positions.current.set(viewKey, node.scrollTop);
    };
  }, [viewKey]);
  useEffect(() => {
    if (open && !previousOpen.current) {
      lastTrigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      requestAnimationFrame(() =>
        root.current
          ?.querySelector<HTMLElement>("[data-panel-heading]")
          ?.focus(),
      );
    }
    if (!open && previousOpen.current) lastTrigger.current?.focus();
    previousOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePanel();
      }
      if (e.key === "Tab" && mobile && sheetExpanded) {
        const nodes = Array.from(
          root.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]',
          ) ?? [],
        ).filter(
          (n) => !n.closest("[hidden]") && n.getClientRects().length > 0,
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !nodes.includes(document.activeElement as HTMLElement))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, mobile, sheetExpanded, closePanel]);
  return (
    <aside
      ref={root}
      hidden={!open}
      className={`content-panel ${sheetExpanded ? "is-expanded" : ""}`}
      role={mobile && sheetExpanded ? "dialog" : "complementary"}
      aria-modal={mobile && sheetExpanded ? true : undefined}
      aria-label={title}
    >
      <div
        className="sheet-handle"
        onClick={() => {
          if (!dragged.current) setSheetExpanded(!sheetExpanded);
          dragged.current = false;
        }}
        onPointerDown={(e) => {
          dragged.current = false;
          touchStart.current = e.clientY;
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerUp={(e) => {
          if (
            touchStart.current !== null &&
            Math.abs(e.clientY - touchStart.current) > 20
          ) {
            dragged.current = true;
            setSheetExpanded(e.clientY < touchStart.current);
          }
          touchStart.current = null;
        }}
      >
        <button aria-label={sheetExpanded ? "Collapse panel" : "Expand panel"}>
          <span />
        </button>
      </div>
      <header className="panel-header">
        <div className="panel-heading">
          {panelHistory.length > 0 && (
            <button
              className="icon-button"
              aria-label="Back"
              onClick={backPanel}
            >
              <Icon name="back" />
            </button>
          )}
          <h1 data-panel-heading tabIndex={-1}>
            {title}
          </h1>
        </div>
        <button
          className="icon-button"
          aria-label="Close panel"
          onClick={closePanel}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="panel-body" ref={body}>
        {children}
      </div>
    </aside>
  );
}
