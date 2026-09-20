#!/usr/bin/env python3
"""Safely extract only the reviewed project master table from an XLSX file."""
import importlib.util,json,pathlib,posixpath,re,sys,zipfile,xml.etree.ElementTree as ET
base=pathlib.Path(__file__).with_name("extract-investors-xlsx.py")
spec=importlib.util.spec_from_file_location("safe_xlsx",base); safe=importlib.util.module_from_spec(spec); spec.loader.exec_module(safe)
MASTER="总表"; REQUIRED=["項目","项目负责人","项目成员","行业与领域","项目阶段（受理、立项、内核、投委会、交割）","项目最新进度","更新日期","下周工作计划","计划更新日期"]
def worksheet(archive,sheet):
 workbook=safe.safe_xml(archive.read("xl/workbook.xml")); sheets=workbook.findall("s:sheets/s:sheet",safe.NS); found=[x for x in sheets if x.get("name")==sheet]
 if len(found)!=1: raise ValueError(f"必须且只能有一个工作表：{sheet}")
 rels=safe.safe_xml(archive.read("xl/_rels/workbook.xml.rels")); match=[x for x in rels if x.get("Id")==found[0].get(safe.REL_ID)]
 if len(match)!=1 or match[0].get("TargetMode")=="External": raise ValueError("总表关系无效或指向外部文件。")
 target=match[0].get("Target",""); target=posixpath.normpath(target.lstrip("/") if target.startswith("/") else f"xl/{target}")
 if not target.startswith("xl/worksheets/") or not target.endswith(".xml"): raise ValueError("总表路径无效。")
 return target,[x.get("name") for x in sheets]
def cells(data,strings):
 root=safe.safe_xml(data)
 if root.find("s:mergeCells",safe.NS) is not None: raise ValueError("总表包含合并单元格，请先取消合并并确认每行数据。")
 result=[]
 for row in root.findall("s:sheetData/s:row",safe.NS):
  values={}
  for cell in row.findall("s:c",safe.NS):
   index=safe.column_index(cell.get("r",""));
   if index in values: raise ValueError("总表包含重复单元格。")
   values[index]=safe.cell_value(cell,strings)
  if any(str(x).strip() for x in values.values()): result.append((int(row.get("r","0")),values))
 return result
def date(value,label):
 raw=str(value or "").strip(); match=re.fullmatch(r"(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+\d{1,2}:\d{2})?",raw)
 if not match: raise ValueError(f"{label}无效：{raw}")
 import datetime
 try: return datetime.date(*map(int,match.groups())).isoformat()
 except ValueError: raise ValueError(f"{label}无效：{raw}")
def split(value): return [x.strip() for x in re.split(r"[,，、;；]",str(value or "")) if x.strip()]
def read_workbook(path):
 with zipfile.ZipFile(path) as archive:
  names=archive.namelist()
  if len(set(names))!=len(names) or len(names)>10000: raise ValueError("XLSX存在重复ZIP成员或成员过多。")
  if sum(x.file_size for x in archive.infolist())>safe.MAX_UNCOMPRESSED: raise ValueError("XLSX解压大小超出128 MB限制。")
  target,names_of_sheets=worksheet(archive,MASTER); strings=safe.shared_strings(archive.read("xl/sharedStrings.xml")) if "xl/sharedStrings.xml" in names else []
  rows=cells(archive.read(target),strings)
  if not rows: raise ValueError("项目总表为空。")
  headers=[rows[0][1].get(i,"").strip() for i in range(9)]
  if headers!=REQUIRED or any(i>=9 and str(v).strip() for _,row in rows for i,v in row.items()): raise ValueError("项目总表表头或列数不符合固定模板。")
  items=[]
  for row_number,row in rows[1:]:
   values=[row.get(i,"") for i in range(9)]
   if not str(values[0]).strip(): raise ValueError(f"第{row_number}行缺少项目名称。")
   items.append({"sourceRow":row_number,"projectName":str(values[0]).strip(),"owner":str(values[1]).strip() or None,"members":split(values[2]),"industry":str(values[3]).strip() or None,"stage":str(values[4]).strip() or None,"latestProgress":str(values[5]).strip(),"updatedAt":date(values[6],f"第{row_number}行更新日期"),"nextPlan":str(values[7]).strip() or None,"nextPlanUpdatedAt":date(values[8],f"第{row_number}行计划更新日期") if str(values[8]).strip() else None})
  return {"sourceSheet":MASTER,"otherSheets":[x for x in names_of_sheets if x!=MASTER],"items":items}
if __name__=="__main__":
 try:
  if len(sys.argv)!=2 or pathlib.Path(sys.argv[1]).suffix.lower()!='.xlsx': raise ValueError("用法：python3 scripts/extract-project-tracking-xlsx.py <项目推进表.xlsx>")
  print(json.dumps(read_workbook(sys.argv[1]),ensure_ascii=False))
 except (OSError,ValueError,KeyError,zipfile.BadZipFile,ET.ParseError) as error:
  print(f"提取失败：{error}",file=sys.stderr);sys.exit(1)
