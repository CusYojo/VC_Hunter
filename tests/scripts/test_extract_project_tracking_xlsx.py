import importlib.util,json,pathlib,tempfile,unittest,zipfile
SCRIPT=pathlib.Path(__file__).resolve().parents[2]/"scripts"/"extract-project-tracking-xlsx.py"
spec=importlib.util.spec_from_file_location("reader",SCRIPT); reader=importlib.util.module_from_spec(spec); spec.loader.exec_module(reader)
headers=reader.REQUIRED
class Extract(unittest.TestCase):
 def book(self,path,formula=False,merge=False):
  values=headers+["项目甲","黄总","余勤, 国袭明","半导体","投委会","已完成内核","2026年8月3日","推进协议","2026年8月4日"]
  strings=''.join(f'<si><t>{str(x)}</t></si>' for x in values)
  cells=[]
  for r in range(1,3):
   row=[]
   for c in range(9):
    index=(r-1)*9+c; ref=f'{chr(65+c)}{r}'; row.append(f'<c r="{ref}" t="s"><v>{index}</v></c>' if not (formula and ref=='F2') else f'<c r="{ref}"><f>1+1</f><v>2</v></c>')
   cells.append(f'<row r="{r}">{"".join(row)}</row>')
  sheet=f'<worksheet xmlns="{reader.safe.NS["s"]}"><sheetData>{"".join(cells)}</sheetData>{"<mergeCells count=\"1\"><mergeCell ref=\"A1:B1\"/></mergeCells>" if merge else ""}</worksheet>'
  workbook=f'<workbook xmlns="{reader.safe.NS["s"]}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="总表" sheetId="1" r:id="r1"/><sheet name="明细" sheetId="2" r:id="r2"/></sheets></workbook>'
  rels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>'
  with zipfile.ZipFile(path,'w') as z:z.writestr('xl/workbook.xml',workbook);z.writestr('xl/_rels/workbook.xml.rels',rels);z.writestr('xl/sharedStrings.xml',f'<sst xmlns="{reader.safe.NS["s"]}">{strings}</sst>');z.writestr('xl/worksheets/sheet1.xml',sheet)
 def test_extracts_only_master_with_source_rows(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'x.xlsx';self.book(p); result=reader.read_workbook(p)
   self.assertEqual(result['otherSheets'],['明细']);self.assertEqual(result['items'][0],{'sourceRow':2,'projectName':'项目甲','owner':'黄总','members':['余勤','国袭明'],'industry':'半导体','stage':'投委会','latestProgress':'已完成内核','updatedAt':'2026-08-03','nextPlan':'推进协议','nextPlanUpdatedAt':'2026-08-04'})
 def test_rejects_formula_and_merge(self):
  for formula,merge in [(True,False),(False,True)]:
   with tempfile.TemporaryDirectory() as d:
    p=pathlib.Path(d)/'x.xlsx';self.book(p,formula,merge)
    with self.assertRaises(ValueError):reader.read_workbook(p)
if __name__=='__main__':unittest.main()
