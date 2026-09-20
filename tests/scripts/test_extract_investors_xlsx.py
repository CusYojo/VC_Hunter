"""Read-only XLSX parsing tests use in-memory XML, never a real database/workbook."""
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts/extract-investors-xlsx.py"
spec = importlib.util.spec_from_file_location("extract_investors", SCRIPT)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
def sheet(rows):
    return f'<worksheet xmlns="{NS}"><sheetData>{rows}</sheetData></worksheet>'.encode()

def inline(ref, value):
    return f'<c r="{ref}" t="inlineStr"><is><t>{value}</t></is></c>'


class ExtractTests(unittest.TestCase):
    def test_sparse_cells_preserve_columns_and_rich_text(self):
        xml = sheet('<row r="1">' + inline("A1", "机构名") + inline("B1", "备注") + inline("C1", "来源URL") + '</row>'
                    '<row r="2">' + inline("A2", "机构") + inline("C2", "https://example.com/a/") + '</row>')
        self.assertEqual(reader.parse_sheet(xml, []), [{"机构名": "机构", "备注": "", "来源URL": "https://example.com/a/"}])
        self.assertEqual(reader.shared_strings(f'<sst xmlns="{NS}"><si><r><t>甲</t></r><r><t>乙</t></r></si></sst>'.encode()), ["甲乙"])

    def test_shared_string_and_numeric_cell(self):
        xml = sheet('<row r="1">' + inline("A1", "机构名") + inline("B1", "序号") + '</row>'
                    '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><v>1</v></c></row>')
        self.assertEqual(reader.parse_sheet(xml, ["机构"]), [{"机构名": "机构", "序号": "1"}])

    def test_rejects_formulas_missing_headers_and_duplicate_columns(self):
        invalid = [
            '<row r="1">' + inline("A1", "机构名") + '</row><row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row>',
            '<row r="1">' + inline("A1", "公司") + '</row>',
            '<row r="1">' + inline("A1", "机构名") + inline("B1", "机构名") + '</row>',
            '<row r="1">' + inline("A1", "机构名") + '</row><row r="2">' + inline("A2", "机构") + inline("B2", "丢失列") + '</row>',
        ]
        for xml in invalid:
            with self.subTest(xml=xml), self.assertRaises(ValueError):
                reader.parse_sheet(sheet(xml), [])

    def test_rejects_external_xml_entities(self):
        with self.assertRaises(ValueError):
            reader.safe_xml(b'<!DOCTYPE foo [<!ENTITY x "secret">]><foo>&x;</foo>')

    def test_selects_only_exact_master_sheet_and_ignores_other_sheet_content(self):
        class Archive:
            files = {
                "xl/workbook.xml": f'<workbook xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="300家机构总表" r:id="rId1"/><sheet name="第二批新增核验" r:id="rId2"/></sheets></workbook>'.encode(),
                "xl/_rels/workbook.xml.rels": b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
                "xl/worksheets/sheet1.xml": sheet('<row r="1">' + inline("A1", "机构名") + '</row><row r="2">' + inline("A2", "唯一机构") + '</row>'),
                "xl/worksheets/sheet2.xml": b"DO NOT PARSE",
            }
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def namelist(self): return list(self.files)
            def infolist(self): return []
            def read(self, name): return self.files[name]
        with patch.object(reader.zipfile, "ZipFile", return_value=Archive()):
            result = reader.read_workbook("input.xlsx")
        self.assertEqual(result["items"], [{"机构名": "唯一机构"}])
        self.assertEqual(result["ignoredSheets"], ["第二批新增核验"])
        Archive.files = {**Archive.files, "xl/workbook.xml": Archive.files["xl/workbook.xml"].replace("300家机构总表".encode(), "别的总表".encode())}
        with patch.object(reader.zipfile, "ZipFile", return_value=Archive()), self.assertRaises(ValueError):
            reader.read_workbook("input.xlsx")


if __name__ == "__main__":
    unittest.main()
