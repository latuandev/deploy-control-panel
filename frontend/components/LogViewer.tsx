"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

interface LogEntry {
  line: string;
  timestamp: string;
}

export function LogViewer({ lines }: { lines: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  return (
    <div className="h-[62vh] overflow-auto rounded bg-zinc-950 p-4 font-mono text-sm leading-6 text-zinc-100 shadow-panel ring-1 ring-zinc-800">
      {lines.length === 0 ? (
        <div className="text-zinc-500">Waiting for log output...</div>
      ) : (
        lines.map((entry, index) => (
          <div key={`${entry.timestamp}-${index}`} className="whitespace-pre-wrap break-words">
            <span className="select-none text-zinc-500">
              {new Date(entry.timestamp).toLocaleTimeString()}{" "}
            </span>
            <AnsiText text={entry.line} />
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}

interface AnsiToken {
  text: string;
  style: CSSProperties;
}

const ANSI_PATTERN = /\x1b\[([0-9;]*)m/g;
const ANSI_COLORS: Record<number, string> = {
  30: "#111827",
  31: "#f87171",
  32: "#34d399",
  33: "#fbbf24",
  34: "#60a5fa",
  35: "#c084fc",
  36: "#22d3ee",
  37: "#e5e7eb",
  90: "#6b7280",
  91: "#fb7185",
  92: "#4ade80",
  93: "#fde047",
  94: "#93c5fd",
  95: "#d8b4fe",
  96: "#67e8f9",
  97: "#f9fafb"
};

const ANSI_BACKGROUND_COLORS: Record<number, string> = {
  40: "#111827",
  41: "#7f1d1d",
  42: "#14532d",
  43: "#713f12",
  44: "#1e3a8a",
  45: "#581c87",
  46: "#164e63",
  47: "#f3f4f6",
  100: "#374151",
  101: "#991b1b",
  102: "#166534",
  103: "#854d0e",
  104: "#1d4ed8",
  105: "#7e22ce",
  106: "#0e7490",
  107: "#ffffff"
};

function AnsiText({ text }: { text: string }) {
  return <>{parseAnsiText(text).map((token, index) => (
    <span key={index} style={token.style}>
      {token.text}
    </span>
  ))}</>;
}

function parseAnsiText(text: string): AnsiToken[] {
  const tokens: AnsiToken[] = [];
  let currentStyle: CSSProperties = {};
  let lastIndex = 0;

  ANSI_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(ANSI_PATTERN)) {
    if (match.index > lastIndex) {
      tokens.push({
        text: text.slice(lastIndex, match.index),
        style: { ...currentStyle }
      });
    }

    const codes = parseAnsiCodes(match[1]);
    currentStyle = applyAnsiCodes(currentStyle, codes);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({
      text: text.slice(lastIndex),
      style: { ...currentStyle }
    });
  }

  return tokens.length ? tokens : [{ text, style: {} }];
}

function parseAnsiCodes(rawCodes: string): number[] {
  if (!rawCodes) {
    return [0];
  }
  return rawCodes
    .split(";")
    .map((code) => Number(code || 0))
    .filter((code) => Number.isFinite(code));
}

function applyAnsiCodes(style: CSSProperties, codes: number[]): CSSProperties {
  let nextStyle = { ...style };

  for (const code of codes) {
    if (code === 0) {
      nextStyle = {};
    } else if (code === 1) {
      nextStyle.fontWeight = 700;
    } else if (code === 2) {
      nextStyle.opacity = 0.72;
    } else if (code === 3) {
      nextStyle.fontStyle = "italic";
    } else if (code === 4) {
      nextStyle.textDecoration = "underline";
    } else if (code === 22) {
      delete nextStyle.fontWeight;
      delete nextStyle.opacity;
    } else if (code === 23) {
      delete nextStyle.fontStyle;
    } else if (code === 24) {
      delete nextStyle.textDecoration;
    } else if (code === 39) {
      delete nextStyle.color;
    } else if (code === 49) {
      delete nextStyle.backgroundColor;
    } else if (ANSI_COLORS[code]) {
      nextStyle.color = ANSI_COLORS[code];
    } else if (ANSI_BACKGROUND_COLORS[code]) {
      nextStyle.backgroundColor = ANSI_BACKGROUND_COLORS[code];
    }
  }

  return nextStyle;
}
