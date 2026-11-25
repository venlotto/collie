import { Component, lazy, Suspense } from "react";
import type { ComponentType, ReactNode } from "react";

import { MARK_STYLE, beadFill, useMark, type MarkProps, type MarkSpec } from "@/components/mark-contract";
import { useMarkId } from "@/lib/mark";
import { useMarkMotion } from "@/lib/mark-motion";
import type { MarkId } from "@/lib/mark-ids";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/koperca-brand";

const SPEC: MarkSpec = {
  id: "koperca-hub",
  beads: 8,
  paced: /^kh-orbit$/u,
  liveClass: "kh-live",
  look: {
    rest: { "--kh-ink": "currentColor", "--kh-accent": "oklch(0.64 0.2 285)" },
    live: { "--kh-ink": "currentColor", "--kh-accent": "oklch(0.72 0.19 289)" },
  },
  accents: ["--kh-accent", "--kh-ink"],
  turnVar: "--kh-turn",
  paperVar: "--kh-paper",
  view: { full: "0 0 64 64", header: "0 0 64 64" },
};

const STYLE = `${MARK_STYLE}
  [data-mark="koperca-hub"] .kh-orbit{transform-origin:32px 32px;animation:kh-orbit var(--kh-turn) linear infinite}
  [data-mark="koperca-hub"] .kh-frame{fill:none;stroke:var(--kh-ink);stroke-width:3.2;stroke-linejoin:round}
  [data-mark="koperca-hub"] .kh-k{fill:none;stroke:var(--kh-ink);stroke-width:5;stroke-linecap:round;stroke-linejoin:round}
  @keyframes kh-orbit{to{transform:rotate(360deg)}}
`;

/**
 * Koperca's geometric K/hub monogram. It implements the upstream mark contract so status motion,
 * reduced-motion handling and the imperative playback-rate hook continue to work unchanged.
 */
export function HubMark({ title, ...props }: MarkProps) {
  const given: MarkProps = { ...props };
  if (title !== undefined) given.title = title;
  const mark = useMark(SPEC, given);
  return (
    <svg {...mark.root}>
      <style>{STYLE}</style>
      <path className="kh-frame" d="M32 5 54 18v28L32 59 10 46V18Z" />
      <path className="kh-k" d="M24 19v26M25 32l15-13M25 32l16 14" />
      <g className="kh-orbit" aria-hidden="true">
        <circle className="kh-node" cx="32" cy="5" r="3" fill={beadFill(0, "var(--kh-accent)")} />
        <circle className="kh-node" cx="46" cy="9" r="2.5" fill={beadFill(1, "var(--kh-accent)")} />
        <circle className="kh-node" cx="55" cy="22" r="2.5" fill={beadFill(2, "var(--kh-accent)")} />
        <circle className="kh-node" cx="55" cy="42" r="2.5" fill={beadFill(3, "var(--kh-accent)")} />
        <circle className="kh-node" cx="46" cy="55" r="2.5" fill={beadFill(4, "var(--kh-accent)")} />
        <circle className="kh-node" cx="18" cy="55" r="2.5" fill={beadFill(5, "var(--kh-accent)")} />
        <circle className="kh-node" cx="9" cy="42" r="2.5" fill={beadFill(6, "var(--kh-accent)")} />
        <circle className="kh-node" cx="9" cy="22" r="2.5" fill={beadFill(7, "var(--kh-accent)")} />
      </g>
    </svg>
  );
}

type UpstreamDogMarkId = Extract<MarkId, "collie" | "collie-collar" | "collie-blaze">;

function isUpstreamDog(id: MarkId): id is UpstreamDogMarkId {
  return id === "collie" || id === "collie-collar" || id === "collie-blaze";
}

type HostedChunkedMarkId = Exclude<MarkId, UpstreamDogMarkId>;

function loadHostedChunk(id: HostedChunkedMarkId) {
  switch (id) {
    case "kawaii":
      return import("./kawaii-mark").then((module) => ({ default: module.KawaiiMark }));
    case "kawaii-tilt":
      return import("./kawaii-tilt-mark").then((module) => ({ default: module.KawaiiTiltMark }));
    case "pixel":
      return import("./pixel-mark").then((module) => ({ default: module.PixelMark }));
    case "glass":
      return import("./glass-mark").then((module) => ({ default: module.GlassMark }));
    case "glass-front":
      return import("./glass-front-mark").then((module) => ({ default: module.GlassFrontMark }));
    case "sheep":
      return import("./sheep-mark").then((module) => ({ default: module.SheepMark }));
    case "owl":
      return import("./owl-mark").then((module) => ({ default: module.OwlMark }));
  }
}

const HOSTED_LAZY = {
  kawaii: lazy(() => loadHostedChunk("kawaii")),
  "kawaii-tilt": lazy(() => loadHostedChunk("kawaii-tilt")),
  pixel: lazy(() => loadHostedChunk("pixel")),
  glass: lazy(() => loadHostedChunk("glass")),
  "glass-front": lazy(() => loadHostedChunk("glass-front")),
  sheep: lazy(() => loadHostedChunk("sheep")),
  owl: lazy(() => loadHostedChunk("owl")),
} as const satisfies Record<HostedChunkedMarkId, ComponentType<MarkProps>>;

export async function loadHostedMark(id: MarkId): Promise<ComponentType<MarkProps>> {
  if (isUpstreamDog(id)) return HubMark;
  return (await loadHostedChunk(id)).default;
}

export async function preloadHostedMark(id: MarkId): Promise<void> {
  if (isUpstreamDog(id)) return;
  try {
    await loadHostedChunk(id);
  } catch {
    // Rendering retries through React.lazy and the app's normal chunk recovery path.
  }
}

class FallBackToHub extends Component<{ props: MarkProps; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <HubMark {...this.props.props} /> : this.props.children;
  }
}

export interface HostedBrandMarkProps extends MarkProps {
  mark?: MarkId;
}

/** Maps legacy dog ids kept in saved themes/preferences to the hosted fork's own mark. */
export function HostedBrandMark({ mark, ...given }: HostedBrandMarkProps) {
  const worn = useMarkId();
  const id = mark ?? worn;
  const props = useMarkMotion(given);
  if (isUpstreamDog(id)) return <HubMark {...props} />;
  const Chunked = HOSTED_LAZY[id];
  const size = props.size ?? 32;
  return (
    <FallBackToHub key={id} props={props}>
      <Suspense fallback={<span aria-hidden="true" data-slot="brand-mark-pending" className="inline-block" style={{ width: size, height: size }} />}>
        <Chunked {...props} />
      </Suspense>
    </FallBackToHub>
  );
}

export function hostedMarkName(id: MarkId, upstreamName: string): string {
  if (id === "collie-collar") return `${APP_SHORT_NAME} Classic`;
  if (id === "collie-blaze") return `${APP_SHORT_NAME} Solid`;
  return id === "collie" ? APP_SHORT_NAME : upstreamName;
}

export function HubWordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`wordmark inline-flex min-w-0 items-baseline gap-1 font-semibold tracking-tight ${className}`.trim()}
      role="img"
      aria-label={APP_NAME}
    >
      <span>Koperca</span>
      <span className="font-medium text-muted-foreground">Agent Hub</span>
    </span>
  );
}

