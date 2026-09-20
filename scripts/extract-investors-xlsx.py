#!/usr/bin/env python3
"""Read only the institution master sheet; JSON goes to stdout, source is never saved.

Uses Python standard library only. No Excel automation, formulas or network access.
Other sheets are listed for review but never parsed/imported or used to overwrite rows.
"""
import json
import pathlib
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

MASTER_SHEET = "300家机构总表"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
MAX_UNCOMPRESSED = 128 * 1024 * 1024


def safe_xml(data):
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("XML 不允许 DTD 或实体声明。")
    return ET.fromstring(data)


def shared_strings(data):
    return ["".join(node.itertext()) for node in safe_xml(data).findall("s:si", NS)]


def column_index(reference):
    match = re.fullmatch(r"([A-Z]{1,3})([1-9][0-9]*)", reference)
    if not match:
        raise ValueError(f"无效单元格坐标：{reference}")
    index = 0
    for letter in match.group(1):
        index = index * 26 + ord(letter) - 64
    if index > 200 or int(match.group(2)) > 10000:
        raise ValueError("工作表超出导入大小限制。")
    return index - 1


def cell_value(cell, strings):
    if cell.find("s:f", NS) is not None:
        raise ValueError("机构总表包含公式；请先人工核对并提供静态值，不能静默采用缓存结果。")
    if cell.get("t") == "e":
        raise ValueError("机构总表包含 Excel 错误单元格。")
    if cell.get("t") == "inlineStr":
        inline = cell.find("s:is", NS)
        return "".join(inline.itertext()) if inline is not None else ""
    value = cell.findtext("s:v", "", NS)
    if cell.get("t") == "s":
        index = int(value)
        if index < 0 or index >= len(strings):
            raise ValueError("共享字符串索引无效。")
        return strings[index]
    return value


def parse_sheet(data, strings):
    rows = []
    for row in safe_xml(data).findall("s:sheetData/s:row", NS):
        cells = {}
        for cell in row.findall("s:c", NS):
            index = column_index(cell.get("r", ""))
            if index in cells:
                raise ValueError("重复单元格坐标。")
            cells[index] = cell_value(cell, strings)
        if any(value.strip() for value in cells.values()):
            rows.append(cells)
    if not rows:
        raise ValueError("机构总表为空。")
    width = max(rows[0]) + 1
    headers = [rows[0].get(index, "").strip() for index in range(width)]
    if not all(headers) or len(set(headers)) != width or "机构名" not in headers:
        raise ValueError("机构总表表头无效（必须包含机构名，且不能有空列名或重名）。")
    if any(any(index >= width and value.strip() for index, value in row.items()) for row in rows[1:]):
        raise ValueError("存在表头之外的数据列，禁止丢失数据。")
    return [{header: row.get(index, "") for index, header in enumerate(headers)} for row in rows[1:]]


def read_workbook(path):
    with zipfile.ZipFile(path, "r") as archive:
        names = archive.namelist()
        if len(set(names)) != len(names) or len(names) > 10000:
            raise ValueError("XLSX 存在重复 ZIP 成员或成员过多。")
        if sum(item.file_size for item in archive.infolist()) > MAX_UNCOMPRESSED:
            raise ValueError("XLSX 解压大小超出 128 MB 限制。")
        workbook = safe_xml(archive.read("xl/workbook.xml"))
        sheets = workbook.findall("s:sheets/s:sheet", NS)
        master = [sheet for sheet in sheets if sheet.get("name") == MASTER_SHEET]
        if len(master) != 1:
            raise ValueError(f"必须且只能有一个工作表：{MASTER_SHEET}")
        relationships = safe_xml(archive.read("xl/_rels/workbook.xml.rels"))
        matches = [node for node in relationships if node.get("Id") == master[0].get(REL_ID)]
        if len(matches) != 1 or matches[0].get("TargetMode") == "External":
            raise ValueError("机构总表关系无效或指向外部文件。")
        target = matches[0].get("Target", "")
        target = posixpath.normpath(target.lstrip("/") if target.startswith("/") else f"xl/{target}")
        if not target.startswith("xl/worksheets/") or not target.endswith(".xml"):
            raise ValueError("机构总表路径无效。")
        strings = shared_strings(archive.read("xl/sharedStrings.xml")) if "xl/sharedStrings.xml" in names else []
        return {"sourceSheet": MASTER_SHEET, "ignoredSheets": [sheet.get("name") for sheet in sheets if sheet is not master[0]],
                "items": parse_sheet(archive.read(target), strings)}


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2 or pathlib.Path(sys.argv[1]).suffix.lower() != ".xlsx":
            raise ValueError("用法：python3 scripts/extract-investors-xlsx.py <机构工作簿.xlsx>")
        print(json.dumps(read_workbook(sys.argv[1]), ensure_ascii=False))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        print(f"提取失败：{error}", file=sys.stderr)
        sys.exit(1)
