import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Note } from "../types/note";

const FILE_TYPES: Record<Note["type"], { extension: string; mimeType: string }> = {
  md: { extension: "md", mimeType: "text/markdown;charset=utf-8" },
  txt: { extension: "txt", mimeType: "text/plain;charset=utf-8" },
  csharp: { extension: "cs", mimeType: "text/plain;charset=utf-8" },
  sql: { extension: "sql", mimeType: "text/plain;charset=utf-8" },
  json: { extension: "json", mimeType: "application/json;charset=utf-8" },
  xml: { extension: "xml", mimeType: "application/xml;charset=utf-8" },
};

export function safeFileStem(title: string): string {
  return title.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";
}

export function noteFileExtension(note: Note): string {
  return FILE_TYPES[note.type].extension;
}

export function downloadNoteFile(note: Note): void {
  const body = note.type === "md"
    ? `# ${note.title || "Untitled"}\n\n${note.content}\n`
    : note.content;
  const fileType = FILE_TYPES[note.type];
  const blob = new Blob([body], { type: fileType.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileStem(note.title)}.${fileType.extension}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const CODE_TYPE_LABELS: Partial<Record<Note["type"], string>> = {
  csharp: "C#",
  sql: "SQL",
  json: "JSON",
  xml: "XML",
};

async function renderPreviewMarkup(note: Note): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  if (!note.content.trim()) return '<p class="preview-empty">Nothing to preview yet.</p>';
  if (note.type === "md") {
    return renderToStaticMarkup(
      React.createElement(
        ReactMarkdown,
        {
          remarkPlugins: [remarkGfm],
          components: {
            img: ({ alt }) => React.createElement("span", { className: "export-image-placeholder" }, `Image: ${alt || "image"}`),
          },
        },
        note.content,
      ),
    );
  }
  if (note.type === "txt") {
    return renderToStaticMarkup(React.createElement("pre", { className: "plain-text-preview" }, note.content));
  }
  const language = CODE_TYPE_LABELS[note.type] ?? "Code";
  return renderToStaticMarkup(
    React.createElement("div", { className: "code-block" },
      React.createElement("div", { className: "code-block-bar" },
        React.createElement("span", { className: "code-block-lang" }, language),
      ),
      React.createElement("pre", null, React.createElement("code", null, note.content)),
    ),
  );
}

function getPreviewStyles(): string {
  const css = Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSStyleRule => "selectorText" in rule)
    .filter((rule) => /\.(?:markdown-preview|plain-text-preview|code-block|code-block-bar|code-block-lang|preview-empty)\b/.test(rule.selectorText))
    .map((rule) => rule.cssText)
    .join("\n")
    .replace(/&/g, "&amp;");
  const rootStyle = getComputedStyle(document.documentElement);
  const variables = Array.from({ length: rootStyle.length }, (_, index) => rootStyle.item(index))
    .filter((name) => name.startsWith("--"))
    .map((name) => `${name}:${rootStyle.getPropertyValue(name)};`)
    .join("");
  return `${css}\n:root{${variables}}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not render the note preview image."));
    image.src = src;
  });
}

export async function downloadNotePng(note: Note): Promise<void> {
  const width = 1200;
  const stage = document.createElement("div");
  stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;padding:44px;box-sizing:border-box;background:#f5eee3;`;
  const preview = document.createElement("div");
  preview.innerHTML = await renderPreviewMarkup(note);
  const card = document.createElement("div");
  card.style.cssText = "padding:36px;background:#fff;border:3px solid #141414;border-radius:18px;box-shadow:8px 8px 0 #ffd02f;";
  const title = document.createElement("h1");
  title.textContent = note.title || "Untitled";
  title.style.cssText = "margin:0 0 22px;padding:0 0 16px;border-bottom:3px solid #ff90e8;color:#141414;font:900 32px/1.25 Arial,sans-serif;overflow-wrap:anywhere;";
  preview.className = "markdown-preview";
  preview.style.cssText = "box-sizing:border-box;width:100%;min-height:0;height:auto;max-height:none;margin:0;padding:24px 22px;overflow:visible;";
  card.append(title, preview);
  stage.appendChild(card);
  document.body.appendChild(stage);

  try {
    const height = Math.max(220, stage.scrollHeight);
    const styles = getPreviewStyles();
    const styleTag = `<style>${styles}</style>`;
    const content = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;padding:44px;box-sizing:border-box;overflow:hidden;background:#f5eee3;">${styleTag}${stage.innerHTML}</div>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%">${content}</foreignObject></svg>`;
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create a canvas for the note preview image.");
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("Could not create the note preview PNG."));
      }, "image/png");
    });
    const pngUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = pngUrl;
    anchor.download = `${safeFileStem(note.title)}.png`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1_000);
  } finally {
    stage.remove();
  }
}
