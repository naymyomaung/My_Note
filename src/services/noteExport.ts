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
            a: ({ children }) => React.createElement(
              "span",
              {
                style: {
                  padding: "0 3px",
                  background: "#92efff",
                  borderBottom: "2px solid #141414",
                  color: "#141414",
                  fontWeight: 700,
                },
              },
              children,
            ),
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not render the note preview image."));
    image.src = src;
  });
}

interface PreviewBlock {
  text: string;
  kind: "heading" | "paragraph" | "code" | "quote" | "list" | "table";
  headingLevel?: number;
}

function getBlockText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  if (node.tagName === "BR") return "\n";
  if (node.tagName === "IMG") return `Image: ${node.getAttribute("alt") || "image"}`;
  return Array.from(node.childNodes, getBlockText).join("");
}

function getPreviewBlocks(markup: string): PreviewBlock[] {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const blocks: PreviewBlock[] = [];
  function visit(node: Element): void {
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ text: getBlockText(node), kind: "heading", headingLevel: Number(tag[1]) });
    } else if (tag === "pre") {
      blocks.push({ text: getBlockText(node), kind: "code" });
    } else if (tag === "blockquote") {
      blocks.push({ text: getBlockText(node), kind: "quote" });
    } else if (tag === "ul" || tag === "ol") {
      const items = Array.from(node.children).filter((child) => child.tagName.toLowerCase() === "li");
      items.forEach((item, index) => {
        blocks.push({ text: `${tag === "ol" ? `${index + 1}.` : "•"} ${getBlockText(item)}`, kind: "list" });
      });
    } else if (tag === "table") {
      Array.from(node.querySelectorAll("tr")).forEach((row) => {
        blocks.push({
          text: Array.from(row.querySelectorAll("th, td"), getBlockText).join("  |  "),
          kind: "table",
        });
      });
    } else if (tag === "hr") {
      blocks.push({ text: "────────────────────────────────────────────────────────", kind: "paragraph" });
    } else if (tag === "p") {
      blocks.push({ text: getBlockText(node), kind: "paragraph" });
    } else {
      Array.from(node.children).forEach(visit);
    }
  }
  Array.from(parsed.body.children).forEach(visit);
  return blocks;
}

function escapeSvgText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrapPreviewText(value: string, maxCharacters: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let line = "";
    for (let word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + word.length + 1 > maxCharacters) {
        lines.push(line);
        line = "";
      }
      while (word.length > maxCharacters) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(word.slice(0, maxCharacters));
        word = word.slice(maxCharacters);
      }
      line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

export async function downloadNotePng(note: Note): Promise<void> {
  const width = 1200;
  const contentWidth = 1024;
  const markup = await renderPreviewMarkup(note);
  const blocks = getPreviewBlocks(markup);
  const titleLines = wrapPreviewText(note.title || "Untitled", 52);
  const titleLineHeight = 38;
  const dividerY = 102 + (titleLines.length - 1) * titleLineHeight + 25;
  let y = dividerY + 52;
  const svgParts = [
    `<rect width="${width}" height="100%" fill="#f5eee3"/>`,
    `<rect x="44" y="44" width="1112" height="100%" rx="18" fill="#fff" stroke="#141414" stroke-width="3"/>`,
  ];
  titleLines.forEach((line, index) => {
    svgParts.push(`<text x="82" y="${102 + index * titleLineHeight}" fill="#141414" font-family="Arial,sans-serif" font-size="32" font-weight="900">${escapeSvgText(line)}</text>`);
  });
  svgParts.push(`<path d="M82 ${dividerY} H1118" stroke="#ff90e8" stroke-width="3"/>`);

  for (const block of blocks) {
    const kind = block.kind;
    const level = block.headingLevel ?? 2;
    const fontSize = kind === "heading"
      ? level === 1 ? 25 : level === 2 ? 21 : 18
      : kind === "code" ? 13 : 16;
    const lineHeight = kind === "heading" ? fontSize + 10 : kind === "code" ? 21 : 25;
    const maxCharacters = Math.floor(contentWidth / (fontSize * 0.58));
    const lines = wrapPreviewText(block.text, maxCharacters);
    if (kind === "heading" && level === 1) {
      const boxY = y - fontSize - 8;
      const boxHeight = lines.length * lineHeight + 16;
      svgParts.push(`<rect x="76" y="${boxY}" width="${Math.min(1048, Math.max(240, block.text.length * fontSize * 0.58 + 40))}" height="${boxHeight}" rx="9" fill="#ffd02f" stroke="#141414" stroke-width="2"/>`);
    } else if (kind === "code" || kind === "quote") {
      const rectY = y - 17;
      const rectHeight = lines.length * lineHeight + 18;
      svgParts.push(`<rect x="76" y="${rectY}" width="1048" height="${rectHeight}" rx="8" fill="${kind === "code" ? "#141414" : "#fff6e9"}" stroke="${kind === "code" ? "#141414" : "#ff90e8"}" stroke-width="2"/>`);
    }
    const fill = kind === "code" ? "#ffd02f" : "#292820";
    const weight = kind === "heading" ? "900" : "400";
    const x = kind === "list" ? 96 : 88;
    lines.forEach((line) => {
      svgParts.push(`<text x="${x}" y="${y}" fill="${fill}" font-family="${kind === "code" ? "Consolas,monospace" : "Arial,sans-serif"}" font-size="${fontSize}" font-weight="${weight}">${escapeSvgText(line)}</text>`);
      y += lineHeight;
    });
    y += kind === "heading" ? level === 1 ? 20 : 14 : 12;
  }
  const height = Math.max(260, y + 48);
  svgParts[1] = `<rect x="44" y="44" width="1112" height="${height - 88}" rx="18" fill="#fff" stroke="#141414" stroke-width="3"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgParts.join("")}</svg>`;
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  let image: HTMLImageElement;
  try {
    image = await loadImage(svgUrl);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
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
}
