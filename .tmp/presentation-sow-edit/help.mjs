import { FileBlob, PresentationFile } from "@oai/artifact-tool";
const deck = await PresentationFile.importPptx(await FileBlob.load("/Users/Krizpham/Work/72HRS/TOOL/b2b-tool/.tmp/presentation-sow-edit/template-starter.pptx"));
const snap = await deck.inspect({kind:"table",maxChars:5000});
const rec = JSON.parse(snap.ndjson.split(/\r?\n/).find(Boolean));
const table = deck.resolve(rec.id);
console.log("own", Object.getOwnPropertyNames(table));
let p = Object.getPrototypeOf(table);
while (p) {
  console.log("proto", Object.getOwnPropertyNames(p));
  p = Object.getPrototypeOf(p);
}
console.log("rows own", Object.getOwnPropertyNames(table.rows));
p = Object.getPrototypeOf(table.rows);
while (p) {
  console.log("rows proto", Object.getOwnPropertyNames(p));
  p = Object.getPrototypeOf(p);
}
console.log("before", table.rowCount, table.columnCount);
try {
  table.setValues(Array.from({length:8},(_,r)=>[`r${r}`,`v${r}`]));
  console.log("after", table.rowCount, table.columnCount, table.rows.length);
} catch (error) {
  console.error("setValues failed", error);
}
