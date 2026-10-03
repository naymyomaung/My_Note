import type { Note } from "../types/note";

export function safeFileStem(title: string): string {
  return title.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";
}

export function downloadNoteFile(note: Note): void {
  const body = `# ${note.title || "Untitled"}\n\n${note.content}\n`;
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileStem(note.title)}.md`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const trial = line ? `${line} ${word}` : word;
      if (ctx.measureText(trial).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    out.push(line);
  }
  return out;
}

export function downloadNotePng(note: Note): void {
  const width = 1200;
  const pad = 70;
  const maxText = width - pad * 2;
  const measurer = document.createElement("canvas").getContext("2d");
  if (!measurer) return;

  const title = note.title || "Untitled";
  measurer.font = "900 64px Arial, sans-serif";
  const titleLines = wrapLines(measurer, title, maxText).slice(0, 3);
  measurer.font = "400 30px Arial, sans-serif";
  const bodyLines = wrapLines(measurer, note.content.trim() || "Empty note", maxText).slice(0, 26);

  const headerH = 150;
  const titleH = titleLines.length * 78;
  const bodyH = bodyLines.length * 46;
  const height = headerH + 60 + titleH + 30 + bodyH + 130;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.min(height, 2200);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Paper + dotted texture
  ctx.fillStyle = "#FFF6E9";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(20,20,20,0.08)";
  for (let y = 30; y < canvas.height; y += 34) {
    for (let x = 30; x < width; x += 34) {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Header band
  ctx.fillStyle = "#FFD02F";
  ctx.fillRect(0, 0, width, headerH);
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, headerH - 8, width, 8);
  ctx.fillStyle = "#141414";
  ctx.font = "800 28px Arial, sans-serif";
  ctx.fillText("✳  MY NOTE", pad, 70);
  ctx.textAlign = "right";
  ctx.font = "700 24px Arial, sans-serif";
  ctx.fillStyle = "#4a463c";
  const date = new Date(note.updatedAt);
  ctx.fillText(Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), width - pad, 70);
  ctx.textAlign = "left";

  // Title
  let y = headerH + 60;
  ctx.fillStyle = "#141414";
  ctx.font = "900 64px Arial, sans-serif";
  for (const line of titleLines) {
    ctx.fillText(line, pad, y);
    y += 78;
  }
  // Pink underline bar
  ctx.fillStyle = "#FF90E8";
  ctx.strokeStyle = "#141414";
  ctx.lineWidth = 4;
  const barW = 150;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(pad, y - 40, barW, 14, 7);
  else ctx.rect(pad, y - 40, barW, 14);
  ctx.fill();
  ctx.stroke();
  y += 10;

  // Tags
  if (note.tags.length > 0) {
    ctx.font = "800 26px Arial, sans-serif";
    ctx.fillStyle = "#4a463c";
    ctx.fillText(note.tags.slice(0, 5).map((tag) => `#${tag}`).join("   "), pad, y);
    y += 48;
  }

  // Body
  ctx.font = "400 30px Arial, sans-serif";
  ctx.fillStyle = "#33322b";
  for (const line of bodyLines) {
    if (y > canvas.height - 90) break;
    if (line === "") {
      y += 23;
      continue;
    }
    ctx.fillText(line, pad, y);
    y += 46;
  }

  // Frame
  ctx.strokeStyle = "#141414";
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, width - 10, canvas.height - 10);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileStem(note.title)}.png`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }, "image/png");
}
