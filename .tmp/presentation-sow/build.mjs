import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const W = 1280;
const H = 720;
const NAVY = "#1F3A5F";
const LIGHT = "#E8EEF6";
const WHITE = "#FFFFFF";
const INK = "#17212B";
const GRAY = "#5D6978";
const MID = "#AAB5C2";
const LINE = "#D7DEE8";
const SOFT = "#F6F8FB";
const FONT = "Calibri";
const PROJECT_SOURCE = "/Users/Krizpham/Work/72HRS/TOOL/b2b-tool/docs/SCOPE_OF_WORK.md";
const SHOPIFY_CATALOGS = "https://shopify.dev/docs/apps/build/b2b/manage-catalogs";
const SHOPIFY_B2B = "https://shopify.dev/docs/apps/build/b2b/start-building";
const OUT_DIR = "/Users/Krizpham/Work/72HRS/TOOL/b2b-tool/.tmp/presentation-sow/render";
const FINAL_PPTX = "/Users/Krizpham/Work/72HRS/TOOL/b2b-tool/docs/BMG_B2B_Scope_of_Work_Summary.pptx";

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
    lineSpacing: options.lineSpacing ?? 1.0,
    typeface: FONT,
    insets: options.insets ?? { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return shape;
}

function addFooter(slide, number, dark = false) {
  const lineColor = dark ? "#6F829B" : LINE;
  const textColor = dark ? "#D7E0EA" : GRAY;
  addShape(slide, "rect", 64, 672, 1152, 1, lineColor, lineColor, 0);
  addText(slide, "B2B Tool — Scope of Work Summary", 64, 683, 450, 20, {
    fontSize: 14,
    color: textColor,
    valign: "middle",
  });
  addText(slide, String(number).padStart(2, "0"), 1158, 683, 58, 20, {
    fontSize: 14,
    color: textColor,
    align: "right",
    valign: "middle",
  });
}

function addSlideTitle(slide, title, number) {
  addShape(slide, "rect", 64, 42, 7, 46, NAVY, NAVY, 0);
  addText(slide, title, 88, 34, 1080, 62, {
    fontSize: 44,
    bold: true,
    color: NAVY,
    valign: "middle",
    wrap: "none",
  });
  addFooter(slide, number);
}

function addBullet(slide, text, left, top, width, options = {}) {
  const size = options.dotSize ?? 10;
  addShape(slide, "ellipse", left, top + 10, size, size, options.dotColor ?? NAVY, options.dotColor ?? NAVY, 0);
  return addText(slide, text, left + 24, top, width - 24, options.height ?? 40, {
    fontSize: options.fontSize ?? 21,
    bold: options.bold ?? false,
    color: options.color ?? INK,
    valign: "middle",
  });
}

function addCheckRow(slide, number, title, detail, top) {
  addShape(slide, "ellipse", 86, top, 48, 48, NAVY, NAVY, 0);
  addText(slide, "✓", 86, top - 1, 48, 48, {
    fontSize: 28,
    bold: true,
    color: WHITE,
    align: "center",
    valign: "middle",
  });
  addText(slide, title, 160, top - 2, 385, 32, { fontSize: 24, bold: true, color: NAVY, valign: "middle" });
  addText(slide, detail, 560, top - 2, 610, 50, { fontSize: 19, color: GRAY, valign: "middle" });
  if (number < 4) addShape(slide, "rect", 160, top + 64, 1010, 1, LINE, LINE, 0);
}

function addSourceNotes(slide, sources = [PROJECT_SOURCE]) {
  const notes = ["[Sources]", ...sources.map((source) => `- ${source}`), "[/Sources]"].join("\n");
  slide.speakerNotes.textFrame.setText(notes);
  slide.speakerNotes.setVisible(true);
}

function addRightArrow(slide, left, top, width = 54, height = 26) {
  return addShape(slide, "rightArrow", left, top, width, height, LIGHT, LIGHT, 0);
}

function addNode(slide, label, sublabel, left, top, width, height, emphasis = false) {
  addShape(slide, "roundRect", left, top, width, height, emphasis ? NAVY : WHITE, emphasis ? NAVY : LINE, emphasis ? 0 : 1.5, "rounded-lg");
  addText(slide, label, left + 12, top + 14, width - 24, 30, {
    fontSize: 22,
    bold: true,
    color: emphasis ? WHITE : NAVY,
    align: "center",
    valign: "middle",
  });
  if (sublabel) {
    addText(slide, sublabel, left + 12, top + 48, width - 24, 28, {
      fontSize: 16,
      color: emphasis ? "#DDE6F0" : GRAY,
      align: "center",
      valign: "middle",
    });
  }
}

async function writeBlob(filePath, blob) {
  await fs.writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
}

async function buildDeck() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });

  const presentation = Presentation.create({ slideSize: { width: W, height: H } });

  // Slide 1 — Title
  {
    const slide = presentation.slides.add();
    slide.background.fill = WHITE;
    addShape(slide, "rect", 0, 0, 26, H, NAVY, NAVY, 0);
    addShape(slide, "rect", 850, 0, 430, H, LIGHT, LIGHT, 0);
    addShape(slide, "rect", 850, 0, 16, H, NAVY, NAVY, 0);
    addText(slide, "BMG B2B Product &\nGroup Pricing Integration", 88, 158, 700, 170, {
      fontSize: 58,
      bold: true,
      color: NAVY,
      lineSpacing: 0.92,
    });
    addText(slide, "Scope of Work — Summary for Approval", 90, 354, 680, 46, {
      fontSize: 27,
      color: GRAY,
      valign: "middle",
    });
    addShape(slide, "rect", 90, 424, 150, 4, NAVY, NAVY, 0);
    addText(slide, "Shopify Plus (72hours.ca, b2b-site) + NetSuite", 90, 454, 670, 40, {
      fontSize: 20,
      color: INK,
      valign: "middle",
    });
    addText(slide, "INTERNAL REPORT", 920, 204, 280, 34, {
      fontSize: 18,
      bold: true,
      color: NAVY,
      align: "center",
      valign: "middle",
    });
    addShape(slide, "ellipse", 970, 282, 180, 180, WHITE, NAVY, 3);
    addText(slide, "B2B\nTOOL", 995, 312, 130, 120, {
      fontSize: 34,
      bold: true,
      color: NAVY,
      align: "center",
      valign: "middle",
      lineSpacing: 0.9,
    });
    addFooter(slide, 1);
    addSourceNotes(slide);
  }

  // Slide 2 — Problem
  {
    const slide = presentation.slides.add();
    slide.background.fill = WHITE;
    addSlideTitle(slide, "Three systems create one manual workflow", 2);

    const columns = [92, 446, 800];
    const names = ["72hours.ca", "NetSuite", "b2b-site"];
    const labels = ["Product content", "Group pricing", "B2B customers"];
    for (let i = 0; i < 3; i++) {
      addText(slide, names[i], columns[i], 150, 290, 50, { fontSize: 30, bold: true, color: NAVY, align: "center", valign: "middle" });
      addShape(slide, "rect", columns[i] + 62, 214, 166, 4, NAVY, NAVY, 0);
      addText(slide, labels[i], columns[i], 236, 290, 36, { fontSize: 21, color: GRAY, align: "center", valign: "middle" });
    }
    addRightArrow(slide, 390, 184, 48, 24);
    addRightArrow(slide, 744, 184, 48, 24);

    addText(slide, "Manual operations increase execution risk", 88, 326, 650, 42, {
      fontSize: 27,
      bold: true,
      color: INK,
      valign: "middle",
    });
    addShape(slide, "roundRect", 72, 396, 1136, 194, NAVY, NAVY, 0, "rounded-lg");
    const issues = [
      ["Slow updates", "Repeated manual work"],
      ["Wrong price / SKU", "Customer trust risk"],
      ["Missing content", "Inconsistent catalog"],
      ["No audit trail", "Hard to investigate"],
    ];
    for (let i = 0; i < issues.length; i++) {
      const x = 100 + i * 275;
      if (i > 0) addShape(slide, "rect", x - 24, 432, 1, 116, "#7890AC", "#7890AC", 0);
      addText(slide, issues[i][0], x, 430, 235, 38, { fontSize: 23, bold: true, color: WHITE, valign: "middle" });
      addText(slide, issues[i][1], x, 485, 235, 48, { fontSize: 18, color: "#D7E0EA", valign: "middle" });
    }
    addSourceNotes(slide);
  }

  // Slide 3 — Solution overview
  {
    const slide = presentation.slides.add();
    slide.background.fill = WHITE;
    addSlideTitle(slide, "One app orchestrates content and group pricing", 3);

    addText(slide, "PRODUCT CONTENT", 82, 130, 180, 28, { fontSize: 16, bold: true, color: GRAY, valign: "middle" });
    addRightArrow(slide, 340, 196, 62, 28);
    addRightArrow(slide, 662, 196, 62, 28);
    addNode(slide, "72hours.ca", "Source content", 82, 166, 250, 92, false);
    addNode(slide, "B2B Tool", "Map • sync • audit", 410, 166, 244, 92, true);
    addNode(slide, "b2b-site", "Target products", 732, 166, 250, 92, false);

    addText(slide, "GROUP PRICING", 82, 324, 180, 28, { fontSize: 16, bold: true, color: GRAY, valign: "middle" });
    addRightArrow(slide, 340, 390, 62, 28);
    addRightArrow(slide, 662, 390, 62, 28);
    addNode(slide, "NetSuite", "Groups + SKU prices", 82, 360, 250, 92, false);
    addNode(slide, "B2B Tool", "Validate • upsert", 410, 360, 244, 92, true);
    addNode(slide, "B2B Catalog", "Catalog + Price List", 732, 360, 250, 92, false);

    addShape(slide, "leftArrow", 990, 390, 62, 28, LIGHT, LIGHT, 0);
    addNode(slide, "Admin assigns", "Company Location → group", 1058, 360, 160, 92, false);

    addShape(slide, "roundRect", 238, 518, 804, 82, LIGHT, LIGHT, 0, "rounded-lg");
    addText(slide, "LOGIN", 276, 540, 90, 32, { fontSize: 18, bold: true, color: NAVY, align: "center", valign: "middle" });
    addText(slide, "→", 380, 536, 40, 36, { fontSize: 26, bold: true, color: NAVY, align: "center", valign: "middle" });
    addText(slide, "Correct group prices", 440, 536, 270, 36, { fontSize: 25, bold: true, color: NAVY, align: "center", valign: "middle" });
    addText(slide, "PDP  •  Cart  •  Checkout", 738, 538, 250, 32, { fontSize: 19, color: GRAY, align: "center", valign: "middle" });
    addSourceNotes(slide, [PROJECT_SOURCE, SHOPIFY_CATALOGS, SHOPIFY_B2B]);
  }

  // Slide 4 — Objectives
  {
    const slide = presentation.slides.add();
    slide.background.fill = WHITE;
    addSlideTitle(slide, "Four outcomes define project success", 4);
    const items = [
      ["01", "Automate product information sync", "72hours.ca → b2b-site"],
      ["02", "Sync NetSuite group prices", "Groups + SKU prices → Price Lists"],
      ["03", "Assign customers by Company Location", "One primary pricing group"],
      ["04", "Show correct prices after login", "Product page • cart • checkout"],
    ];
    for (let i = 0; i < items.length; i++) {
      const y = 136 + i * 124;
      addText(slide, items[i][0], 86, y, 74, 48, { fontSize: 34, bold: true, color: NAVY, valign: "middle" });
      addText(slide, items[i][1], 190, y, 560, 38, { fontSize: 25, bold: true, color: INK, valign: "middle" });
      addText(slide, items[i][2], 780, y, 390, 38, { fontSize: 19, color: GRAY, align: "right", valign: "middle" });
      if (i < 3) addShape(slide, "rect", 190, y + 76, 980, 1, LINE, LINE, 0);
    }
    addSourceNotes(slide, [PROJECT_SOURCE, SHOPIFY_CATALOGS, SHOPIFY_B2B]);
  }

  // Slide 5 — Scope table
  {
    const slide = presentation.slides.add();
    slide.background.fill = WHITE;
    addSlideTitle(slide, "MVP scope covers six operational workstreams", 5);
    const values = [
      ["Workstream", "Included scope"],
      ["Product Sync", "Webhook: title, SKU, description, images, SEO, tags. Price and inventory excluded."],
      ["Product Mapping UI", "SKU suggestion, manual confirmation, preview, sync and retry."],
      ["NetSuite Pricing Sync", "Read groups and SKU prices; upsert Shopify Price Lists."],
      ["Pricing Sync UI", "Group ↔ catalog mapping, price preview, errors and history."],
      ["Customer Assignment UI", "Search, assign, bulk assign and change history."],
      ["Dashboard", "Connection status, mapping counts and issue list."],
    ];
    const table = slide.tables.add({
      rows: 7,
      columns: 2,
      left: 72,
      top: 128,
      width: 1136,
      height: 430,
      columnWidths: [288, 848],
      values,
    });
    table.borders.assign({ style: "solid", fill: LINE, width: 1 });
    for (let row = 0; row < 7; row++) {
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
    table.rows[0].height = 44;
    for (let row = 1; row < 7; row++) table.rows[row].height = 63;
    addShape(slide, "roundRect", 72, 580, 1136, 52, LIGHT, LIGHT, 0, "rounded-md");
    addText(slide, "Source of truth: 72hours.ca = content  •  NetSuite = pricing  •  b2b-site = customers", 92, 590, 1096, 32, {
      fontSize: 18,
      bold: true,
      color: NAVY,
      align: "center",
      valign: "middle",
    });
    addSourceNotes(slide, [PROJECT_SOURCE, SHOPIFY_CATALOGS]);
  }

  // Slide 6 — Out of scope
  {
    const slide = presentation.slides.add();
    slide.background.fill = WHITE;
    addSlideTitle(slide, "MVP stays focused on products and group pricing", 6);
    addShape(slide, "rect", 72, 134, 286, 472, NAVY, NAVY, 0);
    addText(slide, "OUT OF\nMVP", 106, 230, 218, 126, {
      fontSize: 48,
      bold: true,
      color: WHITE,
      align: "center",
      valign: "middle",
      lineSpacing: 0.9,
    });
    addText(slide, "Deferred for later phases", 104, 388, 222, 48, { fontSize: 19, color: "#D7E0EA", align: "center", valign: "middle" });

    const exclusions = [
      "Inventory, order, customer sync with NetSuite",
      "Promotions, discounts, volume pricing, tax rules",
      "Per-customer pricing outside defined groups",
      "Auto-delete products or auto-fix duplicate SKUs",
    ];
    for (let i = 0; i < exclusions.length; i++) {
      const y = 156 + i * 108;
      addText(slide, String(i + 1).padStart(2, "0"), 414, y, 52, 38, { fontSize: 22, bold: true, color: NAVY, valign: "middle" });
      addText(slide, exclusions[i], 486, y, 660, 52, { fontSize: 23, bold: true, color: INK, valign: "middle" });
      if (i < 3) addShape(slide, "rect", 486, y + 72, 660, 1, LINE, LINE, 0);
    }
    addSourceNotes(slide);
  }

  // Slide 7 — Deliverables
  {
    const slide = presentation.slides.add();
    slide.background.fill = WHITE;
    addSlideTitle(slide, "Deliverables cover build, operations and quality", 7);
    const deliveries = [
      ["01", "Embedded Shopify admin app", "Custom distribution • both Plus stores"],
      ["02", "Two synchronization services", "Queue • retry • audit log"],
      ["03", "Operations interfaces", "Mapping • pricing • assignment • dashboard"],
      ["04", "Production readiness", "Dev • staging • production • docs • tests"],
    ];
    for (let i = 0; i < deliveries.length; i++) {
      const y = 134 + i * 122;
      addShape(slide, "ellipse", 80, y, 58, 58, i === 0 ? NAVY : LIGHT, i === 0 ? NAVY : LIGHT, 0);
      addText(slide, deliveries[i][0], 80, y, 58, 58, { fontSize: 19, bold: true, color: i === 0 ? WHITE : NAVY, align: "center", valign: "middle" });
      addText(slide, deliveries[i][1], 174, y - 2, 430, 34, { fontSize: 25, bold: true, color: NAVY, valign: "middle" });
      addText(slide, deliveries[i][2], 634, y - 2, 520, 46, { fontSize: 19, color: GRAY, align: "right", valign: "middle" });
      if (i < 3) addShape(slide, "rect", 174, y + 78, 980, 1, LINE, LINE, 0);
    }
    addSourceNotes(slide);
  }

  // Slide 8 — Acceptance
  {
    const slide = presentation.slides.add();
    slide.background.fill = WHITE;
    addSlideTitle(slide, "Approval depends on four measurable outcomes", 8);
    addCheckRow(slide, 1, "Product changes propagate", "Mapped products update automatically", 142);
    addCheckRow(slide, 2, "Pricing sync is idempotent", "Correct values; no duplicate records", 264);
    addCheckRow(slide, 3, "Price visibility is isolated", "Assigned group only; no leakage", 386);
    addCheckRow(slide, 4, "Operations remain traceable", "Full sync history and audit trail", 508);
    addSourceNotes(slide, [PROJECT_SOURCE, SHOPIFY_CATALOGS, SHOPIFY_B2B]);
  }

  // Slide 9 — Dependencies + decisions
  {
    const slide = presentation.slides.add();
    slide.background.fill = WHITE;
    addSlideTitle(slide, "Four inputs unlock a reliable estimate", 9);
    addShape(slide, "rect", 72, 132, 540, 56, NAVY, NAVY, 0);
    addShape(slide, "rect", 668, 132, 540, 56, LIGHT, LIGHT, 0);
    addText(slide, "DEPENDENCIES", 96, 144, 492, 32, { fontSize: 22, bold: true, color: WHITE, valign: "middle" });
    addText(slide, "TO DECIDE BEFORE ESTIMATE", 692, 144, 492, 32, { fontSize: 22, bold: true, color: NAVY, valign: "middle" });

    const deps = [
      "Confirm same Shopify Plus organization",
      "Store and NetSuite API access",
      "Pricing groups and initial assignments",
      "Unique SKU convention across systems",
    ];
    const decisions = [
      "Create products when unmapped?",
      "Pricing latency: target 15 minutes",
      "NetSuite pricing data interface",
      "Initial volume and first-sync plan",
    ];
    for (let i = 0; i < 4; i++) {
      addBullet(slide, deps[i], 96, 220 + i * 82, 466, { fontSize: 20, height: 50 });
      addBullet(slide, decisions[i], 692, 220 + i * 82, 466, { fontSize: 20, height: 50 });
    }
    addShape(slide, "rect", 640, 204, 1, 350, LINE, LINE, 0);
    addSourceNotes(slide);
  }

  // Slide 10 — Closing
  {
    const slide = presentation.slides.add();
    slide.background.fill = WHITE;
    addShape(slide, "rect", 0, 0, 22, H, NAVY, NAVY, 0);
    addText(slide, "NEXT STEP", 88, 108, 260, 34, { fontSize: 18, bold: true, color: GRAY, valign: "middle" });
    addText(slide, "Close decisions and grant\nNetSuite sandbox access", 88, 164, 900, 136, {
      fontSize: 54,
      bold: true,
      color: NAVY,
      lineSpacing: 0.92,
    });
    addShape(slide, "rightArrow", 90, 356, 1020, 78, LIGHT, LIGHT, 0);
    addText(slide, "OPEN DECISIONS", 132, 374, 220, 38, { fontSize: 19, bold: true, color: NAVY, align: "center", valign: "middle" });
    addText(slide, "+", 390, 374, 42, 38, { fontSize: 26, bold: true, color: NAVY, align: "center", valign: "middle" });
    addText(slide, "SANDBOX ACCESS", 462, 374, 220, 38, { fontSize: 19, bold: true, color: NAVY, align: "center", valign: "middle" });
    addText(slide, "→", 716, 374, 42, 38, { fontSize: 26, bold: true, color: NAVY, align: "center", valign: "middle" });
    addText(slide, "FINAL ESTIMATE + TIMELINE", 790, 374, 280, 38, { fontSize: 19, bold: true, color: NAVY, align: "center", valign: "middle" });
    addText(slide, "Contact: [Project owner / email]", 90, 514, 600, 42, { fontSize: 21, color: GRAY, valign: "middle" });
    addFooter(slide, 10);
    addSourceNotes(slide);
  }

  for (const [index, slide] of presentation.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, "0")}`;
    await writeBlob(path.join(OUT_DIR, `${stem}.png`), await presentation.export({ slide, format: "png", scale: 1 }));
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(path.join(OUT_DIR, `${stem}.layout.json`), await layout.text());
  }

  await writeBlob(path.join(OUT_DIR, "deck-montage.webp"), await presentation.export({ format: "webp", montage: true, scale: 1 }));
  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(FINAL_PPTX);
  console.log(FINAL_PPTX);
}

buildDeck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
