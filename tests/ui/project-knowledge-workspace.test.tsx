// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ProjectAssistant} from '@/components/ai/project-assistant';
import {ProjectKnowledgeUpload} from '@/components/project-knowledge-upload';
const refresh=vi.fn();
vi.mock('next/navigation',()=>({useRouter:()=>({refresh})}));
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
const source={id:'doc-1',type:'document',title:'技术资料.txt',href:'/api/v1/projects/project-1/documents/doc-1/content?download=1',parseStatus:'queued',availability:'pending',truncated:false};
const run={id:'run-1',prompt:'量产时间？',status:'succeeded',output:'预计十月量产。[S1] <script>bad</script>',error:null,provider:'openai',model:'gpt-4.1',sources:[{...source,reference:'S1'}],warnings:['仅使用与问题相关的资料片段。'],usage:{},createdAt:'2026-09-04T00:00:00Z',updatedAt:'2026-09-04T00:00:00Z'};
function mockFetch(){const mock=vi.fn(async (_url:string,options?:RequestInit)=>({ok:true,json:async()=>({data:options?.method==='POST'?run:{runs:[],sources:[source]}})}));vi.stubGlobal('fetch',mock);return mock;}
it('retrieves only through the current project endpoint and requires consent before asking',async()=>{
 const mock=mockFetch();render(<ProjectAssistant projectId="project-1" projectName="一号项目" refreshToken="1"/>);
 await screen.findByText('已连接 1 项项目资料');
 fireEvent.change(screen.getByLabelText('项目问题'),{target:{value:'量产时间？'}});
 expect(screen.getByRole('button',{name:'基于项目知识回答'})).toBeDisabled();
 fireEvent.click(screen.getByLabelText('同意将本次问题及检索到的项目资料发送至我的默认模型服务商。'));
 fireEvent.click(screen.getByRole('button',{name:'基于项目知识回答'}));
 expect(await screen.findByText(run.output)).toBeVisible();
 expect(document.querySelector('script')).toBeNull();
 expect(screen.getByRole('link',{name:'[S1] 技术资料.txt'})).toHaveAttribute('href',source.href);
 const call=mock.mock.calls.find(([,o])=>o?.method==='POST')!;
 expect(call[0]).toBe('/api/v1/projects/project-1/assistant');
 expect(JSON.parse(call[1]!.body as string)).toEqual({prompt:'量产时间？',consent:true});
 expect((call[1]!.headers as Record<string,string>)['idempotency-key']).toBeTruthy();
 expect(screen.getByLabelText('同意将本次问题及检索到的项目资料发送至我的默认模型服务商。')).not.toBeChecked();
});
it('retains a failed question and reuses its retry key after a network failure',async()=>{
 const mock=mockFetch();render(<ProjectAssistant projectId="project-1" projectName="一号项目" refreshToken="1"/>);await screen.findByText('已连接 1 项项目资料');
 fireEvent.change(screen.getByLabelText('项目问题'),{target:{value:'量产时间？'}});fireEvent.click(screen.getByRole('checkbox'));
 mock.mockRejectedValueOnce(new Error('连接中断'));
 fireEvent.click(screen.getByRole('button',{name:'基于项目知识回答'}));await screen.findByRole('alert');
 expect(screen.getByLabelText('项目问题')).toHaveValue('量产时间？');
 fireEvent.click(screen.getByRole('button',{name:'基于项目知识回答'}));await screen.findByText(run.output);
 const calls=mock.mock.calls.filter(([,o])=>o?.method==='POST');expect(calls[0][1]!.headers).toEqual(calls[1][1]!.headers);
});
it('uploads to the bound project and refreshes knowledge with the latest project version',async()=>{
 const saved=vi.fn();const mock=vi.fn(async()=>({ok:true,json:async()=>({data:{projectVersion:8}})}));vi.stubGlobal('fetch',mock);
 render(<ProjectKnowledgeUpload projectId="project-1" version={7} onUploaded={saved}/>);
 fireEvent.change(screen.getByLabelText('知识库文件'),{target:{files:[new File(['材料正文'],'技术资料.txt',{type:'text/plain'})]}});
 fireEvent.click(screen.getByRole('button',{name:'上传到知识库'}));await screen.findByText('资料已加入项目知识库，可向项目助手提问。');
 const [url,options]=mock.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('/api/v1/projects/project-1/documents');
 expect((options.body as FormData).get('expectedVersion')).toBe('7');expect((options.body as FormData).get('externalPolicy')).toBe('local_only');
 await waitFor(()=>expect(saved).toHaveBeenCalled());expect(refresh).toHaveBeenCalled();
});

it('opens the knowledge tab directly for a saved source link',async()=>{
 const {Tabs,TabList,Tab,TabPanels,TabPanel}=await import('@/components/ui/legacy');
 render(<Tabs defaultIndex={1}><TabList><Tab>总览</Tab><Tab>知识</Tab></TabList><TabPanels><TabPanel>项目概况</TabPanel><TabPanel>引用的知识条目</TabPanel></TabPanels></Tabs>);
 expect(screen.getByText('引用的知识条目')).toBeVisible();expect(screen.queryByText('项目概况')).toBeNull();
});

it('uses a new request key after a confirmed completed model failure',async()=>{
 const mock=mockFetch();render(<ProjectAssistant projectId="project-1" projectName="一号项目" refreshToken="1"/>);await screen.findByText('已连接 1 项项目资料');
 fireEvent.change(screen.getByLabelText('项目问题'),{target:{value:'量产时间？'}});fireEvent.click(screen.getByRole('checkbox'));
 mock.mockResolvedValueOnce({ok:false,json:async()=>({data:{...run,status:'failed',error:'模型不可用'},error:{message:'模型不可用'}})} as never);
 fireEvent.click(screen.getByRole('button',{name:'基于项目知识回答'}));await screen.findByRole('alert');
 if(!(screen.getByRole('checkbox') as HTMLInputElement).checked)fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.click(screen.getByRole('button',{name:'基于项目知识回答'}));await screen.findByText(run.output);
 const calls=mock.mock.calls.filter(([,o])=>o?.method==='POST');expect(calls[0][1]!.headers).not.toEqual(calls[1][1]!.headers);
});
