import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import {AudienceSelect} from './AudienceSelect';
import { useWorkspace } from "../app/state";

export function Panel({
  title,
  children,
  viewKey,
  allowFullscreen = false,
  fullscreen = false,
  onFullscreenChange,
}: {
  title: string;
  children: ReactNode;
  viewKey: string;
  allowFullscreen?: boolean;
  fullscreen?: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
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
    modal = fullscreen || (mobile && sheetExpanded),
    previousOpen = useRef(false),
    touchStart = useRef<number | null>(null),
    dragged = useRef(false);
  useLayoutEffect(() => {
    const node = root.current;
    if (!open || fullscreen || !node?.animate ||
      (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    const animation = node.animate(
      [{ transform: "translateX(calc(100% + 24px))", opacity: 0 }, { transform: "translateX(0)", opacity: 1 }],
      { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    return () => animation.cancel();
  }, [open, viewKey, fullscreen]);
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
        if (fullscreen) onFullscreenChange?.(false);
        else closePanel();
      }
      if (e.key === "Tab" && modal) {
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
  }, [open, modal, fullscreen, onFullscreenChange, closePanel]);
  return (
    <aside
      ref={root}
      hidden={!open}
      className={`content-panel ${panel?.view === "assistant" ? "is-assistant" : ""} ${sheetExpanded ? "is-expanded" : ""} ${fullscreen ? "is-fullscreen" : ""}`}
      role={modal ? "dialog" : "complementary"}
      aria-modal={modal ? true : undefined}
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
        <div className="panel-header-actions">
          {mobile && panel?.view === "assistant" && (
            <button className="icon-button" aria-label={sheetExpanded ? "Collapse panel" : "Expand panel"}
              onClick={() => setSheetExpanded(!sheetExpanded)}>
              <Icon name={sheetExpanded ? "collapse" : "expand"} />
            </button>
          )}
          {allowFullscreen && (
            <button
              className="icon-button"
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen news"}
              aria-pressed={fullscreen}
              title={fullscreen ? "Exit fullscreen" : "Fullscreen news"}
              onClick={() => onFullscreenChange?.(!fullscreen)}
            >
              <Icon name={fullscreen ? "restore" : "fullscreen"} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Close panel"
            onClick={closePanel}
          >
            <Icon name="close" />
          </button>
        </div>
      </header>
      {modal && panel?.view !== "assistant" && <div className="panel-audience"><AudienceSelect /></div>}
      <div className="panel-body" ref={body}>
        {children}
      </div>
    </aside>
  );
}
