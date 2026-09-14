import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const source = "/Users/Krizpham/Work/72HRS/TOOL/b2b-tool/docs/BMG_B2B_Scope_of_Work_Summary.pptx";
const out = "/Users/Krizpham/Work/72HRS/TOOL/b2b-tool/.tmp/presentation-sow-edit/full-inspect.ndjson";
const deck = await PresentationFile.importPptx(await FileBlob.load(source));
const result = await deck.inspect({
  kind: "slide,textbox,shape,image,table,chart,notes,layout",
  include: "id,slide,name,title,text,textPreview,textChars,textLines,bbox,bboxUnit,rows,cols,preview,isPlaceholder,placeholders",
  maxChars: 200000,
});
await fs.writeFile(out, `${result.ndjson}\n`, "utf8");
console.log(out);
