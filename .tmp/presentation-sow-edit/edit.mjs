import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const STARTER = "/Users/Krizpham/Work/72HRS/TOOL/b2b-tool/.tmp/presentation-sow-edit/template-starter.pptx";
const FINAL = "/Users/Krizpham/Work/72HRS/TOOL/b2b-tool/docs/BMG_B2B_Scope_of_Work_Summary.pptx";
const PREVIEW_DIR = "/Users/Krizpham/Work/72HRS/TOOL/b2b-tool/.tmp/presentation-sow-edit/final-preview";
const LAYOUT_DIR = "/Users/Krizpham/Work/72HRS/TOOL/b2b-tool/.tmp/presentation-sow-edit/final-layout/final";
const REQUEST_SOURCE = "/Users/Krizpham/.codex/attachments/fa017fe2-3bff-48c1-887f-66baeb893c4b/pasted-text.txt";
const SHOPIFY_CATALOGS = "https://shopify.dev/docs/apps/build/b2b/manage-catalogs";
const SHOPIFY_B2B = "https://shopify.dev/docs/apps/build/b2b/start-building";

const NAVY = "#1F3A5F";
const LIGHT = "#E8EEF6";
const WHITE = "#FFFFFF";
const INK = "#17212B";
const GRAY = "#5D6978";
const LINE = "#D7DEE8";
const SOFT = "#F6F8FB";
const FONT = "Calibri";

function sameBbox(a, b) {
  return Array.isArray(a) && a.length === 4 && a.every((value, index) => Math.abs(value - b[index]) < 0.6);
}

function addShape(slide, geometry, left, top, width, height, fill = "none", lineFill = "none", lineWidth = 0, radius) {
  const config = {
    geometry,
    position: { left, top, width, height },
    fill,
    line: { style: "solid", fill: lineFill, width: lineWidth },
  };
  if (radius) config.borderRadius = radius;
  return slide.shapes.add(config);
}

function addText(slide, value, left, top, width, height, options = {}) {
  const shape = addShape(slide, "textbox", left, top, width, height, "none", "none", 0);
  shape.text = value;
  shape.text.style = {
    fontSize: options.fontSize ?? 22,
    bold: options.bold ?? false,
    color: options.color ?? INK,
    alignment: options.align ?? "left",
    verticalAlignment: options.valign ?? "top",
    autoFit: options.autoFit ?? "shrinkText",
    wrap: options.wrap ?? "square",
    lineSpacing: options.lineSpacing ?? 1,
    typeface: FONT,
    insets: options.insets ?? { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return shape;
}

function addNode(slide, label, sublabel, left, top, width, height, emphasis = false) {
  addShape(slide, "roundRect", left, top, width, height, emphasis ? NAVY : WHITE, emphasis ? NAVY : LINE, emphasis ? 0 : 1.5, "rounded-lg");
  addText(slide, label, left + 12, top + 9, width - 24, 28, {
    fontSize: 21,
    bold: true,
    color: emphasis ? WHITE : NAVY,
    align: "center",
    valign: "middle",
  });
  addText(slide, sublabel, left + 12, top + 39, width - 24, 24, {
    fontSize: 15,
    color: emphasis ? "#DDE6F0" : GRAY,
    align: "center",
    valign: "middle",
  });
}

function addCheckSet(slide, title, detail, top) {
  addShape(slide, "ellipse", 86, top, 42, 42, NAVY, NAVY, 0);
  addText(slide, "✓", 86, top - 1, 42, 42, { fontSize: 25, bold: true, color: WHITE, align: "center", valign: "middle" });
  addText(slide, title, 154, top - 2, 430, 30, { fontSize: 22, bold: true, color: NAVY, valign: "middle" });
  addText(slide, detail, 600, top - 3, 570, 44, { fontSize: 18, color: GRAY, valign: "middle" });
}

function setSources(slide, sources) {
  slide.speakerNotes.textFrame.setText(["[Sources]", ...sources.map((source) => `- ${source}`), "[/Sources]"].join("\n"));
  slide.speakerNotes.setVisible(true);
}

async function writeBlob(filePath, blob) {
  await fs.writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
}

const deck = await PresentationFile.importPptx(await FileBlob.load(STARTER));
const snapshot = await deck.inspect({
  kind: "slide,textbox,shape,table,notes",
  include: "id,slide,text,textPreview,bbox,rows,cols",
  maxChars: 200000,
});
const records = snapshot.ndjson.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

function textRecord(slideNumber, text) {
  const record = records.find((item) => item.slide === slideNumber && item.text === text && (item.kind === "textbox" || item.kind === "shape"));
  if (!record) throw new Error(`Text not found on slide ${slideNumber}: ${text}`);
  return record;
}

function shapeRecord(slideNumber, bbox, kind = "shape") {
  const record = records.find((item) => item.slide === slideNumber && item.kind === kind && sameBbox(item.bbox, bbox));
  if (!record) throw new Error(`Shape not found on slide ${slideNumber} at ${bbox.join(",")}`);
  return record;
}

function resolvedText(slideNumber, text) {
  return deck.resolve(textRecord(slideNumber, text).id);
}

function resolvedShape(slideNumber, bbox, kind = "shape") {
  return deck.resolve(shapeRecord(slideNumber, bbox, kind).id);
}

function setPosition(target, left, top, width, height) {
  target.position = { left, top, width, height };
}

// Slide 2 — independent systems and expanded NetSuite responsibility.
{
  const slide = deck.slides.getItem(1);
  resolvedText(2, "Group pricing").text = "Price, inventory & group pricing";
  resolvedText(2, "Wrong price / SKU").text = "Wrong price / SKU / stock";
  resolvedShape(2, [390, 184, 48, 24]).delete();
  resolvedShape(2, [744, 184, 48, 24]).delete();
  setSources(slide, [REQUEST_SOURCE]);
}

// Slide 3 — three independent integration lanes.
{
  const slide = deck.slides.getItem(2);
  resolvedText(3, "One app orchestrates content and group pricing").text = "One app orchestrates content, price, inventory and group pricing";

  // Content lane: compress upward while preserving inherited elements.
  setPosition(resolvedText(3, "PRODUCT CONTENT"), 82, 112, 220, 24);
  setPosition(resolvedShape(3, [340, 196, 62, 28]), 340, 166, 62, 24);
  setPosition(resolvedShape(3, [662, 196, 62, 28]), 662, 166, 62, 24);
  setPosition(resolvedShape(3, [82, 166, 250, 92]), 82, 142, 250, 72);
  setPosition(resolvedText(3, "72hours.ca"), 94, 151, 226, 28);
  setPosition(resolvedText(3, "Source content"), 94, 181, 226, 24);
  setPosition(resolvedShape(3, [410, 166, 244, 92]), 410, 142, 244, 72);
  setPosition(resolvedText(3, "B2B Tool"), 422, 151, 220, 28);
  setPosition(resolvedText(3, "Map • sync • audit"), 422, 181, 220, 24);
  setPosition(resolvedShape(3, [732, 166, 250, 92]), 732, 142, 250, 72);
  setPosition(resolvedText(3, "b2b-site"), 744, 151, 226, 28);
  setPosition(resolvedText(3, "Target products"), 744, 181, 226, 24);

  // New base-price and inventory lane.
  addText(slide, "PRICE + INVENTORY", 82, 228, 220, 24, { fontSize: 16, bold: true, color: GRAY, valign: "middle" });
  addShape(slide, "rightArrow", 340, 282, 62, 24, LIGHT, LIGHT, 0);
  addShape(slide, "rightArrow", 662, 282, 62, 24, LIGHT, LIGHT, 0);
  addNode(slide, "NetSuite", "List price + stock", 82, 258, 250, 72, false);
  addNode(slide, "B2B Tool", "Validate • upsert", 410, 258, 244, 72, true);
  addNode(slide, "b2b-site", "Variant price + inventory", 732, 258, 250, 72, false);

  // Group pricing lane: move downward and fix assignment copy.
  setPosition(resolvedText(3, "GROUP PRICING"), 82, 344, 220, 24);
  setPosition(resolvedShape(3, [340, 390, 62, 28]), 340, 398, 62, 24);
  setPosition(resolvedShape(3, [662, 390, 62, 28]), 662, 398, 62, 24);
  setPosition(resolvedShape(3, [82, 360, 250, 92]), 82, 374, 250, 72);
  setPosition(resolvedText(3, "NetSuite"), 94, 383, 226, 28);
  setPosition(resolvedText(3, "Groups + SKU prices"), 94, 413, 226, 24);
  setPosition(resolvedShape(3, [410, 360, 244, 92]), 410, 374, 244, 72);
  // Two B2B Tool labels exist; resolve the second by its original bbox.
  const toolLabels = records.filter((item) => item.slide === 3 && item.text === "B2B Tool");
  const groupToolTitle = deck.resolve(toolLabels.find((item) => sameBbox(item.bbox, [422, 374, 220, 30])).id);
  setPosition(groupToolTitle, 422, 383, 220, 28);
  setPosition(resolvedText(3, "Validate • upsert"), 422, 413, 220, 24);
  setPosition(resolvedShape(3, [732, 360, 250, 92]), 732, 374, 250, 72);
  setPosition(resolvedText(3, "B2B Catalog"), 744, 383, 226, 28);
  setPosition(resolvedText(3, "Catalog + Price List"), 744, 413, 226, 24);
  setPosition(resolvedShape(3, [990, 390, 62, 28]), 990, 398, 58, 24);
  setPosition(resolvedShape(3, [1058, 360, 160, 92]), 1054, 374, 164, 72);
  const adminTitle = resolvedText(3, "Admin assigns");
  adminTitle.text.style = { fontSize: 17, bold: true, color: NAVY, alignment: "center", verticalAlignment: "middle", autoFit: "shrinkText", wrap: "none", typeface: FONT };
  setPosition(adminTitle, 1064, 382, 144, 24);
  const assignmentText = resolvedText(3, "Company Location → group");
  assignmentText.text = "Company Location\n→ pricing group";
  assignmentText.text.style = { fontSize: 14, color: GRAY, alignment: "center", verticalAlignment: "middle", autoFit: "shrinkText", typeface: FONT };
  setPosition(assignmentText, 1064, 409, 144, 30);

  // Login outcome banner.
  // Keep the inherited banner geometry intact so it remains a direct template edit.
  setPosition(resolvedShape(3, [238, 518, 804, 82]), 238, 518, 804, 82);
  setPosition(resolvedText(3, "LOGIN"), 276, 540, 90, 32);
  setPosition(resolvedText(3, "→"), 380, 536, 40, 36);
  setPosition(resolvedText(3, "Correct group prices"), 440, 536, 270, 36);
  setPosition(resolvedText(3, "PDP  •  Cart  •  Checkout"), 738, 538, 250, 32);
  setSources(slide, [REQUEST_SOURCE, SHOPIFY_CATALOGS, SHOPIFY_B2B]);
}

// Slide 4 — five outcomes.
{
  const slide = deck.slides.getItem(3);
  resolvedText(4, "Four outcomes define project success").text = "Five outcomes define project success";

  const rows = [
    ["01", "Automate product information sync", "72hours.ca → b2b-site"],
    ["02", "Sync NetSuite product price & inventory", "Variant price + stock on b2b-site"],
    ["03", "Sync NetSuite group prices", "Groups + SKU prices → Price Lists"],
    ["04", "Assign customers by Company Location", "One primary pricing group"],
  ];
  const originalRows = [
    ["01", "Automate product information sync", "72hours.ca → b2b-site"],
    ["02", "Sync NetSuite group prices", "Groups + SKU prices → Price Lists"],
    ["03", "Assign customers by Company Location", "One primary pricing group"],
    ["04", "Show correct prices after login", "Product page • cart • checkout"],
  ];
  const yPositions = [126, 222, 318, 414];
  const dividerBboxes = [[190,212,980,1],[190,336,980,1],[190,460,980,1]];
  for (let i = 0; i < 4; i++) {
    const [oldNumber, oldTitle, oldDetail] = originalRows[i];
    const [newNumber, newTitle, newDetail] = rows[i];
    const numberShape = i === 3
      ? resolvedShape(4, [86, 508, 74, 48], "textbox")
      : resolvedText(4, oldNumber);
    const titleShape = resolvedText(4, oldTitle);
    const detailShape = resolvedText(4, oldDetail);
    numberShape.text = newNumber;
    titleShape.text = newTitle;
    detailShape.text = newDetail;
    setPosition(numberShape, 86, yPositions[i], 74, 44);
    setPosition(titleShape, 190, yPositions[i], 560, 36);
    setPosition(detailShape, 780, yPositions[i], 390, 36);
    if (i < 3) setPosition(resolvedShape(4, dividerBboxes[i]), 190, yPositions[i] + 68, 980, 1);
  }
  addShape(slide, "rect", 190, 482, 980, 1, LINE, LINE, 0);
  addText(slide, "05", 86, 510, 74, 44, { fontSize: 34, bold: true, color: NAVY, valign: "middle" });
  addText(slide, "Show correct prices after login", 190, 510, 560, 36, { fontSize: 25, bold: true, color: INK, valign: "middle" });
  addText(slide, "Product page • cart • checkout", 780, 510, 390, 36, { fontSize: 19, color: GRAY, align: "right", valign: "middle" });
  setSources(slide, [REQUEST_SOURCE, SHOPIFY_CATALOGS, SHOPIFY_B2B]);
}

// Slide 5 — seven workstreams.
{
  const slide = deck.slides.getItem(4);
  resolvedText(5, "MVP scope covers six operational workstreams").text = "MVP scope covers seven operational workstreams";
  const oldTable = records.find((item) => item.slide === 5 && item.kind === "table");
  const values = [
    ["Workstream", "Included scope"],
    ["Product Sync", "Content webhook. Price/stock not copied from 72hours.ca."],
    ["Product Mapping UI", "SKU suggestion, manual confirm, preview, sync, retry."],
    ["Price & Inventory Sync", "NetSuite base price + qty → variant price + inventory."],
    ["Group Pricing Sync", "Groups + SKU prices → Shopify Price Lists."],
    ["Pricing Sync UI", "Group ↔ catalog mapping, preview, errors, history."],
    ["Customer Assignment UI", "Search, assign, bulk assign, change history."],
    ["Dashboard", "Connections, mapping counts, issues."],
  ];
  const table = deck.resolve(oldTable.id);
  table.setValues(values);
  table.position = { left: 72, top: 126, width: 1136, height: 432 };
  table.setColumnWidths([288, 848]);
  table.borders.assign({ style: "solid", fill: LINE, width: 1 });
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 2; col++) {
      const cell = table.getCell(row, col);
      cell.fill = row === 0 ? NAVY : row % 2 === 0 ? SOFT : WHITE;
      cell.text.style = {
        fontSize: row === 0 ? 18 : 16,
        bold: row === 0 || col === 0,
        color: row === 0 ? WHITE : col === 0 ? NAVY : INK,
        verticalAlignment: "middle",
        typeface: FONT,
      };
    }
  }
  table.rows[0].height = 40;
  for (let row = 1; row < 8; row++) table.rows[row].height = 56;
  const banner = resolvedText(5, "Source of truth: 72hours.ca = content  •  NetSuite = pricing  •  b2b-site = customers");
  banner.text = "Source of truth: 72hours.ca = content  •  NetSuite = price, inventory, group pricing  •  b2b-site = customers";
  banner.text.style = { fontSize: 17, bold: true, color: NAVY, alignment: "center", verticalAlignment: "middle", autoFit: "shrinkText", typeface: FONT };
  setSources(slide, [REQUEST_SOURCE, SHOPIFY_CATALOGS]);
}

// Slide 6 — inventory is now in scope.
{
  const slide = deck.slides.getItem(5);
  resolvedText(6, "Inventory, order, customer sync with NetSuite").text = "Order or customer sync with NetSuite";
  setSources(slide, [REQUEST_SOURCE]);
}

// Slide 7 — three sync services.
{
  const slide = deck.slides.getItem(6);
  resolvedText(7, "Two synchronization services").text = "Three synchronization services";
  const subtitle = resolvedText(7, "Queue • retry • audit log");
  subtitle.text = "Content • price & inventory • group pricing\nQueue • retry • audit log";
  subtitle.text.style = { fontSize: 17, color: GRAY, alignment: "right", verticalAlignment: "middle", autoFit: "shrinkText", typeface: FONT };
  setSources(slide, [REQUEST_SOURCE]);
}

// Slide 8 — five acceptance checks.
{
  const slide = deck.slides.getItem(7);
  resolvedText(8, "Approval depends on four measurable outcomes").text = "Approval depends on five measurable outcomes";

  const original = [
    ["Product changes propagate", "Mapped products update automatically"],
    ["Pricing sync is idempotent", "Correct values; no duplicate records"],
    ["Price visibility is isolated", "Assigned group only; no leakage"],
    ["Operations remain traceable", "Full sync history and audit trail"],
  ];
  const revised = [
    ["Product content updates mapped products", "No overwrite of NetSuite price / stock"],
    ["Price and inventory write correctly", "Shopify variants + inventory locations"],
    ["Group pricing sync is idempotent", "Correct values; no duplicate records"],
    ["Price visibility is isolated", "Assigned group; unassigned = base price"],
  ];
  const yPositions = [128, 226, 324, 422];
  const circleBboxes = [[86,142,48,48],[86,264,48,48],[86,386,48,48],[86,508,48,48]];
  const checkBboxes = [[86,141,48,48],[86,263,48,48],[86,385,48,48],[86,507,48,48]];
  const dividerBboxes = [[160,206,1010,1],[160,328,1010,1],[160,450,1010,1]];
  for (let i = 0; i < 4; i++) {
    const circle = resolvedShape(8, circleBboxes[i]);
    const check = resolvedShape(8, checkBboxes[i], "textbox");
    const title = resolvedText(8, original[i][0]);
    const detail = resolvedText(8, original[i][1]);
    title.text = revised[i][0];
    detail.text = revised[i][1];
    setPosition(circle, 86, yPositions[i], 42, 42);
    setPosition(check, 86, yPositions[i] - 1, 42, 42);
    setPosition(title, 154, yPositions[i] - 2, 430, 30);
    setPosition(detail, 600, yPositions[i] - 3, 570, 44);
    if (i < 3) setPosition(resolvedShape(8, dividerBboxes[i]), 154, yPositions[i] + 58, 1016, 1);
  }
  addShape(slide, "rect", 154, 480, 1016, 1, LINE, LINE, 0);
  addCheckSet(slide, "Operations remain traceable", "Full sync history and audit trail", 520);
  setSources(slide, [REQUEST_SOURCE, SHOPIFY_CATALOGS, SHOPIFY_B2B]);
}

// Slide 9 — updated dependencies and open decisions, still four per column.
{
  const slide = deck.slides.getItem(8);
  const dependencies = [
    ["Confirm same Shopify Plus organization", "Store + NetSuite API access"],
    ["Store and NetSuite API access", "NetSuite price/qty fields + locations"],
    ["Pricing groups and initial assignments", "Pricing groups + initial assignments"],
    ["Unique SKU convention across systems", "Unique SKU convention across systems"],
  ];
  const decisions = [
    ["Create products when unmapped?", "Create products when unmapped?"],
    ["Pricing latency: target 15 minutes", "Stock location + base price level?"],
    ["NetSuite pricing data interface", "Price & inventory latency: 15 minutes"],
    ["Initial volume and first-sync plan", "NetSuite pricing data interface"],
  ];
  for (const [oldText, newText] of [...dependencies, ...decisions]) resolvedText(9, oldText).text = newText;
  setSources(slide, [REQUEST_SOURCE]);
}

// Updated request is the governing source for unchanged opening and closing slides too.
setSources(deck.slides.getItem(0), [REQUEST_SOURCE]);
setSources(deck.slides.getItem(9), [REQUEST_SOURCE]);

await fs.mkdir(PREVIEW_DIR, { recursive: true });
await fs.mkdir(LAYOUT_DIR, { recursive: true });
for (const [index, slide] of deck.slides.items.entries()) {
  const stem = `slide-${String(index + 1).padStart(2, "0")}`;
  await writeBlob(path.join(PREVIEW_DIR, `${stem}.png`), await deck.export({ slide, format: "png", scale: 1 }));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(LAYOUT_DIR, `${stem}.layout.json`), await layout.text());
}
await writeBlob("/Users/Krizpham/Work/72HRS/TOOL/b2b-tool/.tmp/presentation-sow-edit/final-montage.webp", await deck.export({ format: "webp", montage: true, scale: 1 }));

const exported = await PresentationFile.exportPptx(deck);
await exported.save(FINAL);
console.log(FINAL);
