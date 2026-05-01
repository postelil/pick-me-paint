"use client";

import { ChangeEvent, DragEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type AppMode = "Idle" | "Uploaded" | "Generating" | "Finished";
type Tool = "pencil" | "brush" | "eraser" | "picker";

type GenerateResponse = {
  imageUrl: string | null;
  imageProxyUrl?: string | null;
  imageDataUrl?: string | null;
  error?: string;
};

const SCRIBBLE_COLORS = [
  "#ff1744", // hot red
  "#ff9100", // vivid orange
  "#ffea00", // bright yellow
  "#00e676", // neon green
  "#00b0ff", // bright cyan/blue
  "#2979ff", // electric blue
  "#d500f9", // neon purple
  "#ff4081", // pink
  "#000000"
];

function seededRandom(seed: number) {
  const value = Math.sin(seed * 999.91) * 10000;
  return value - Math.floor(value);
}

function ScribbleText({ text, seed = 1337 }: { text: string; seed?: number }) {
  const letters = useMemo(() => {
    const chars = text.split("");
    return chars.map((ch, i) => {
      const r = (offset: number) => seededRandom(seed + i * 31 + offset);
      const colorIndex = Math.floor(r(1) * SCRIBBLE_COLORS.length) % SCRIBBLE_COLORS.length;
      const rotate = (r(2) - 0.5) * 10;
      const lift = Math.round((r(3) - 0.5) * 6);
      const skew = (r(4) - 0.5) * 12;
      const scale = 0.92 + r(5) * 0.16;
      return {
        ch,
        style: {
          color: SCRIBBLE_COLORS[colorIndex],
          transform: `rotate(${rotate}deg) translateY(${lift}px) skewX(${skew}deg) scale(${scale})`,
          display: "inline-block",
          textShadow: "1px 1px 0 #000"
        } as const
      };
    });
  }, [seed, text]);

  return (
    <span className="scribble">
      {letters.map((l, idx) => (
        <span key={`${l.ch}-${idx}`} style={l.style}>
          {l.ch === " " ? "\u00A0" : l.ch}
        </span>
      ))}
    </span>
  );
}

const PAPER_WIDTH = 900;
const PAPER_HEIGHT = 560;

const CLASSIC_COLORS = [
  "#000000",
  "#7f7f7f",
  "#880015",
  "#ed1c24",
  "#ff7f27",
  "#fff200",
  "#22b14c",
  "#00a2e8",
  "#3f48cc",
  "#a349a4",
  "#ffffff",
  "#c3c3c3",
  "#b97a57",
  "#ffaec9",
  "#ffc90e",
  "#efe4b0"
];

const TOOLBOX_BUTTONS: Array<{
  id: Tool | "decor-1" | "decor-2" | "decor-3" | "decor-4" | "decor-5" | "decor-6" | "decor-7" | "decor-8";
  label: string;
  functional?: boolean;
}> = [
  { id: "pencil", label: "✏", functional: true },
  { id: "decor-1", label: "⬚" },
  { id: "brush", label: "🖌", functional: true },
  { id: "decor-2", label: "💎" },
  { id: "eraser", label: "🧽", functional: true },
  { id: "picker", label: "⌕", functional: true },
  { id: "decor-3", label: "╱" },
  { id: "decor-4", label: "A" },
  { id: "decor-5", label: "◣" },
  { id: "decor-6", label: "◁" },
  { id: "decor-7", label: "◯" },
  { id: "decor-8", label: "▭" }
];

function getMouse(canvas: HTMLCanvasElement, event: MouseEvent<HTMLCanvasElement>) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * canvas.width) / rect.width,
    y: ((event.clientY - rect.top) * canvas.height) / rect.height
  };
}

function loadImage(src: string, timeoutMs = 45_000) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (/^https?:\/\//i.test(src)) {
      image.crossOrigin = "anonymous";
    }
    const timer = window.setTimeout(() => {
      image.src = "";
      reject(new Error("Image load timeout."));
    }, timeoutMs);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("Failed to load image."));
    };
    image.src = src;
  });
}

async function fileFromUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to fetch dropped image URL.");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("Dropped URL is not an image.");
  const ext = blob.type.split("/")[1] || "png";
  return new File([blob], `dropped-image.${ext}`, { type: blob.type });
}

async function extractImageFileFromDataTransfer(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return null;

  const directFile = dataTransfer.files?.[0];
  if (directFile && directFile.type.startsWith("image/")) return directFile;

  const items = Array.from(dataTransfer.items ?? []);
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }

  const uri = dataTransfer.getData("text/uri-list") || dataTransfer.getData("text/plain");
  if (uri && /^https?:\/\//i.test(uri.trim())) {
    try {
      return await fileFromUrl(uri.trim());
    } catch {
      return null;
    }
  }

  const html = dataTransfer.getData("text/html");
  if (html) {
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    const src = match?.[1];
    if (src && /^https?:\/\//i.test(src)) {
      try {
        return await fileFromUrl(src);
      } catch {
        return null;
      }
    }
  }

  return null;
}

export default function HomePage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isDrawingRef = useRef(false);

  const [mode, setMode] = useState<AppMode>("Idle");
  const [tool, setTool] = useState<Tool>("pencil");
  const [activeColor, setActiveColor] = useState(CLASSIC_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fillCanvasWhite = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return true;
  }, []);

  useEffect(() => {
    fillCanvasWhite();
  }, [fillCanvasWhite]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = PAPER_WIDTH;
    canvas.height = PAPER_HEIGHT;
    fillCanvasWhite();
  }, [fillCanvasWhite]);

  function drawLine(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    activeTool: Tool = tool
  ) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = activeTool === "brush" ? Math.max(strokeWidth, 5) : strokeWidth;
    const color = activeTool === "eraser" ? "#ffffff" : activeColor;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function handlePointerDown(event: MouseEvent<HTMLCanvasElement>) {
    if (tool === "picker") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x, y } = getMouse(canvas, event);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    isDrawingRef.current = true;
    (ctx as CanvasRenderingContext2D & { __lastX?: number }).__lastX = x;
    (ctx as CanvasRenderingContext2D & { __lastY?: number }).__lastY = y;
    drawLine(x, y, x, y);
  }

  function handlePointerMove(event: MouseEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const point = getMouse(canvas, event);
    const lastX = (ctx as CanvasRenderingContext2D & { __lastX?: number }).__lastX ?? point.x;
    const lastY = (ctx as CanvasRenderingContext2D & { __lastY?: number }).__lastY ?? point.y;
    drawLine(lastX, lastY, point.x, point.y);
    (ctx as CanvasRenderingContext2D & { __lastX?: number }).__lastX = point.x;
    (ctx as CanvasRenderingContext2D & { __lastY?: number }).__lastY = point.y;
  }

  function stopDrawing() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    isDrawingRef.current = false;
    delete (ctx as CanvasRenderingContext2D & { __lastX?: number }).__lastX;
    delete (ctx as CanvasRenderingContext2D & { __lastY?: number }).__lastY;
  }

  const drawUploadedImage = useCallback(async (file: File) => {
    const imageUrl = URL.createObjectURL(file);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      const image = await loadImage(imageUrl);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const ratio = Math.min(canvas.width / image.width, canvas.height / image.height);
      const drawWidth = image.width * ratio;
      const drawHeight = image.height * ratio;
      const x = (canvas.width - drawWidth) / 2;
      const y = (canvas.height - drawHeight) / 2;
      ctx.drawImage(image, x, y, drawWidth, drawHeight);
      setMode("Uploaded");
      setError(null);
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }, []);

  const handleIncomingFile = useCallback((file: File | null | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    void drawUploadedImage(file);
  }, [drawUploadedImage]);

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    handleIncomingFile(file);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function onCanvasDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragOver(false);
    void (async () => {
      const file = await extractImageFileFromDataTransfer(event.dataTransfer);
      handleIncomingFile(file);
    })();
  }

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      const items = Array.from(clipboard.items ?? []);
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          event.preventDefault();
          handleIncomingFile(item.getAsFile());
          return;
        }
      }

      const files = Array.from(clipboard.files ?? []);
      const imageFile = files.find((file) => file.type.startsWith("image/"));
      if (imageFile) {
        event.preventDefault();
        handleIncomingFile(imageFile);
      }
    };

    const handleWindowDragOver = (event: globalThis.DragEvent) => {
      event.preventDefault();
      setIsDragOver(true);
    };

    const handleWindowDrop = (event: globalThis.DragEvent) => {
      event.preventDefault();
      setIsDragOver(false);
      void (async () => {
        const file = await extractImageFileFromDataTransfer(event.dataTransfer ?? null);
        handleIncomingFile(file ?? null);
      })();
    };

    const handleWindowDragLeave = (event: globalThis.DragEvent) => {
      if (event.clientX <= 0 && event.clientY <= 0) {
        setIsDragOver(false);
      }
    };

    window.addEventListener("paste", handlePaste);
    document.addEventListener("paste", handlePaste);
    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("drop", handleWindowDrop);
    window.addEventListener("dragleave", handleWindowDragLeave);
    return () => {
      window.removeEventListener("paste", handlePaste);
      document.removeEventListener("paste", handlePaste);
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("drop", handleWindowDrop);
      window.removeEventListener("dragleave", handleWindowDragLeave);
    };
  }, [handleIncomingFile]);

  async function getCanvasFile() {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), "image/png", 1)
    );
    if (!blob) return null;
    return new File([blob], "picme-input.png", { type: "image/png" });
  }

  async function drawFinalResult(urlCandidates: string[]) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let image: HTMLImageElement | null = null;
    for (const url of urlCandidates) {
      if (!url) continue;
      try {
        image = await loadImage(url);
        break;
      } catch {
        // Try next URL candidate.
      }
    }
    if (!image) {
      throw new Error("Could not load generated image from any source.");
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const text = "Pick Me";
    const margin = 18;
    ctx.font = "bold 32px Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#000000";
    ctx.fillStyle = "#ffffff";
    ctx.strokeText(text, canvas.width - margin, canvas.height - margin);
    ctx.fillText(text, canvas.width - margin, canvas.height - margin);
  }

  async function startGenerate() {
    if (mode === "Generating") return;
    setMode("Generating");
    setError(null);

    try {
      const canvasFile = await getCanvasFile();
      if (!canvasFile) {
        setError("Failed to read canvas.");
        setMode("Uploaded");
        return;
      }

      const formData = new FormData();
      formData.append("image", canvasFile);
      const response = await fetch("/api/generate", {
        method: "POST",
        body: formData
      });
      const data = (await response.json()) as GenerateResponse;

      if (!response.ok || (!data.imageUrl && !data.imageDataUrl)) {
        setError(data.error || "Generation failed.");
        setMode("Uploaded");
        return;
      }

      await drawFinalResult([data.imageUrl || "", data.imageProxyUrl || "", data.imageDataUrl || ""]);
      setMode("Finished");
    } catch (generationError) {
      console.error(generationError);
      setError("Network error during generation.");
      setMode("Uploaded");
    }
  }

  async function copyImage() {
    const canvas = canvasRef.current;
    if (!canvas || !navigator.clipboard || typeof ClipboardItem === "undefined") return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }

  function shareOnX() {
    const siteUrl = window.location.origin;
    const text = `My masterpiece generated via ${siteUrl} / Pick Me`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const canGenerate = mode !== "Idle";

  return (
    <main className="win95-shell">
      <div className="paint-window">
        <div className="title-bar">untitled - CanvasPaint</div>
        <div className="menu-bar">
          {["File", "Edit", "View", "Image", "Colors", "Help"].map((item) => (
            <button
              key={item}
              type="button"
              className="menu-item"
              onClick={item === "File" ? openFilePicker : undefined}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="work-area">
          <aside className="toolbox">
            {TOOLBOX_BUTTONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`tool-btn ${tool === item.id ? "pressed" : ""} ${item.functional ? "" : "decorative"}`}
                onClick={item.functional ? () => setTool(item.id as Tool) : undefined}
                title={item.id}
              >
                {item.label}
              </button>
            ))}

            <div className="stroke-control">
              <span>Size</span>
              <input
                type="range"
                min={1}
                max={20}
                value={strokeWidth}
                onChange={(event) => setStrokeWidth(Number(event.target.value))}
                className="size-slider"
              />
            </div>
          </aside>

          <div
            className={`canvas-holder ${isDragOver ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={onCanvasDrop}
          >
            <div className="paper-frame">
              <canvas
                ref={canvasRef}
                width={PAPER_WIDTH}
                height={PAPER_HEIGHT}
                className="paint-canvas"
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
              />
              <div className="resize-handle" aria-hidden />
            </div>

            {mode === "Idle" ? (
              <button type="button" className="upload-overlay" onClick={openFilePicker}>
                <div className="upload-icon" aria-hidden>
                  🖼
                </div>
                <p className="upload-title">
                  Upload your photo to get a clumsy{" "}
                  <span className="pickme-rainbow" aria-label="Pick Me">
                    <span style={{ color: "#ff1744" }}>P</span>
                    <span style={{ color: "#2979ff" }}>i</span>
                    <span style={{ color: "#00e676" }}>c</span>
                    <span style={{ color: "#d500f9" }}>k</span>
                    <span style={{ color: "#000000" }}>&nbsp;</span>
                    <span style={{ color: "#ff9100" }}>M</span>
                    <span style={{ color: "#ff4081" }}>e</span>
                  </span>{" "}
                  redraw.
                </p>
              </button>
            ) : null}

          </div>
        </div>

        <div className="bottom-panel">
          {mode === "Finished" ? (
            <div className="action-row">
              <button type="button" className="win95-btn" onClick={() => void copyImage()}>
                Copy Image
              </button>
              <button type="button" className="win95-btn" onClick={shareOnX}>
                Share on X
              </button>
            </div>
          ) : (
            <div className="bottom-toolbar">
              <div className="palette-row">
                {CLASSIC_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`swatch ${activeColor === color ? "active" : ""}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setActiveColor(color)}
                    title={color}
                  />
                ))}
              </div>
              <div className="fake-options">
                <label>
                  <input type="checkbox" readOnly />
                  pretty curves (slow browsers)
                </label>
                <label>
                  <input type="checkbox" readOnly />
                  draw control points
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="status-bar">
          <span>Tool: {tool}</span>
          <span>Mode: {mode}</span>
          <span>{error ?? "Ready."}</span>
        </div>
      </div>

      <button
        type="button"
        className={`pickme-on-blue ${mode === "Generating" ? "is-loading" : ""}`}
        onClick={startGenerate}
          disabled={mode === "Idle" || mode === "Generating" || !canGenerate}
        title="Pick Me"
      >
        {mode === "Generating" ? "Generating..." : "Pick Me ✏️"}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onFileInput}
      />
    </main>
  );
}
