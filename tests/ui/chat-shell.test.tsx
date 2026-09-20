// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {render,screen} from '@testing-library/react';
import {it,vi,expect} from 'vitest';
import {AiCenter} from '@/components/operating/ai-center';
it('opens a conversation workspace with optional project knowledge',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>({data:url.endsWith('/projects')?{items:[]}:url.endsWith('/settings/ai')?{activeProvider:null,providers:[]}:[]})})));
 try {render(<AiCenter initialView="copilot"/>);expect(await screen.findByRole('button',{name:'新建对话'})).toBeVisible();expect(screen.getByRole('checkbox',{name:'查询知识库'})).not.toBeChecked();expect(screen.getByRole('button',{name:'发送消息'})).toBeDisabled();} finally {vi.unstubAllGlobals();}
});
