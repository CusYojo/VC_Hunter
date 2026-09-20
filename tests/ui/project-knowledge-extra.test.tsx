// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectAssistant } from '@/components/ai/project-assistant';
import { ProjectKnowledgeUpload } from '@/components/project-knowledge-upload';
import { ProjectKnowledgeWorkspace } from '@/components/project-knowledge-workspace';
import type { ProjectAssistantRun, ProjectKnowledgeSource } from '@/ai/project-assistant-contracts';
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const consentLabel = '同意将本次问题及检索到的项目资料发送至我的默认模型服务商。';
const source: ProjectKnowledgeSource = { id: 'doc-1', type: 'document', title: '融资资料.txt', href: '/api/v1/projects/p1/documents/doc-1/content?download=1', parseStatus: 'succeeded', availability: 'ready', truncated: false };
const answer = (values: Partial<ProjectAssistantRun> = {}): ProjectAssistantRun => ({ id: 'run-1', prompt: '项目优势是什么？', status: 'succeeded', output: '技术路线具备量产验证记录。[S1]', error: null, provider: 'openai', model: 'gpt-4.1', sources: [{ ...source, reference: 'S1', truncated: true }], warnings: ['商业化结果仍需核验。'], usage: {}, createdAt: '2026-09-04T10:00:00Z', updatedAt: '2026-09-04T10:00:00Z', ...values });
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });
function question() {
  fireEvent.change(screen.getByLabelText('项目问题'), { target: { value: '项目优势是什么？' } });
  fireEvent.click(screen.getByLabelText(consentLabel));
}

describe('project knowledge recovery and source refresh', () => {
  it('clears a prior load error when uploaded knowledge triggers a successful reload', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: '旧知识加载失败' } }), { status: 503 })).mockResolvedValueOnce(response({ sources: [source], runs: [] }));
    vi.stubGlobal('fetch', fetcher);
    const { rerender } = render(<ProjectAssistant projectId="p1" projectName="项目一" refreshToken="1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('旧知识加载失败');
    rerender(<ProjectAssistant projectId="p1" projectName="项目一" refreshToken="2" />);
    await screen.findByText('已连接 1 项项目资料');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('replaces the selected running answer with its completed result after refresh', async () => {
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return response(answer({ status: 'running', output: '', sources: [], warnings: [] }));
      reads += 1;
      return response({ sources: [source], runs: reads === 1 ? [] : [answer({ output: '刷新后已经完成的回答', updatedAt: '2026-09-04T10:01:00Z' })] });
    }));
    render(<ProjectAssistant projectId="p1" projectName="项目一" refreshToken="1" />);
    await screen.findByText('已连接 1 项项目资料'); question();
    fireEvent.click(screen.getByRole('button', { name: '基于项目知识回答' }));
    await screen.findByText('正在处理，请稍后刷新记录。');
    fireEvent.click(screen.getByRole('button', { name: '刷新知识与记录' }));
    expect(await screen.findByText('刷新后已经完成的回答')).toBeVisible();
    expect(screen.queryByText('正在处理，请稍后刷新记录。')).toBeNull();
  });

  it('blocks asking while a refreshed source snapshot is still loading', async () => {
    let finish: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ sources: [source], runs: [] })).mockReturnValueOnce(pending));
    render(<ProjectAssistant projectId="p1" projectName="项目一" refreshToken="1" />);
    await screen.findByText('已连接 1 项项目资料'); question();
    fireEvent.click(screen.getByRole('button', { name: '刷新知识与记录' }));
    try { await waitFor(() => expect(screen.getByRole('button', { name: '基于项目知识回答' })).toBeDisabled()); }
    finally { await act(async () => finish(response({ sources: [source], runs: [] }))); }
  });
});

describe('project knowledge history and upload boundaries', () => {
  it('shows an honest empty knowledge state and no invented answer history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({})));
    render(<ProjectKnowledgeWorkspace projectId="p1" projectName="项目一" version={1} documents={[]} knowledge={[]} />);
    await screen.findByText('已连接 0 项项目资料');
    expect(screen.getByText('还没有项目资料')).toBeVisible();
    expect(screen.getByText(/暂无知识草稿/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '我的项目问答记录' }));
    expect(screen.getByText('当前项目还没有你的问答记录。')).toBeVisible();
    expect(screen.queryByRole('article', { name: '项目助手回答' })).toBeNull();
    expect(screen.getByRole('button', { name: '上传到知识库' })).toBeDisabled();
  });

  it('reopens persisted completed, failed and running records with source citations', async () => {
    const runs = [answer(), answer({ id: 'failed-run', prompt: '市场规模？', status: 'failed', error: '模型额度不足', sources: [], warnings: [] }), answer({ id: 'running-run', prompt: '成本结构？', status: 'running', output: '', sources: [], warnings: [] })];
    vi.stubGlobal('fetch', vi.fn(async () => response({ sources: [source, { ...source, id: 'draft', title: '未解析原件', availability: 'pending' }, { ...source, id: 'bad', title: '暂不可读原件', availability: 'failed' }], runs })));
    render(<ProjectAssistant projectId="p1" projectName="项目一" refreshToken="1" />);
    await screen.findByText('已连接 3 项项目资料');
    fireEvent.click(screen.getByText('查看项目知识来源'));
    expect(screen.getByText('按需提取正文')).toBeVisible();
    expect(screen.getByText('暂无法读取')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '我的项目问答记录' }));
    fireEvent.click(screen.getByText('项目优势是什么？ · 已完成'));
    expect(screen.getByText('技术路线具备量产验证记录。[S1]')).toBeVisible();
    expect(screen.getByRole('link', { name: '[S1] 融资资料.txt' })).toHaveAttribute('href', source.href);
    expect(screen.getByText('相关片段')).toBeVisible();
    expect(screen.getByText('商业化结果仍需核验。')).toBeVisible();
    fireEvent.click(screen.getByText('市场规模？ · 失败'));
    expect(screen.getByText('模型额度不足')).toBeVisible();
    fireEvent.click(screen.getByText('成本结构？ · 执行中'));
    expect(screen.getByText('正在处理，请稍后刷新记录。')).toBeVisible();
  });

  it('filters knowledge by content and source without confusing rejected knowledge with approved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ sources: [], runs: [] })));
    const knowledge = [
      { id: 'k1', title: '性能报告', content: 'GPU 芯片验证记录', type: '技术', sourceType: 'research_report', status: 'approved', createdAt: '2026-09-04' },
      { id: 'k2', title: '营收口径', content: '重复计算的旧口径', type: '财务', sourceType: 'document', status: 'rejected', createdAt: '2026-09-04' },
      { id: 'k3', title: '待核验材料', content: '新增问题', type: '问答', sourceType: 'evidence', status: 'draft', createdAt: '2026-09-04' },
    ];
    render(<ProjectKnowledgeWorkspace projectId="p1" projectName="项目一" version={1} documents={[]} knowledge={knowledge} />);
    await screen.findByText('已连接 0 项项目资料');
    expect(screen.getByText('已拒绝，不用于问答 · 财务')).toBeVisible();
    expect(screen.getByText('待审核草稿 · 问答')).toBeVisible();
    const search = screen.getByLabelText('搜索项目知识库');
    fireEvent.change(search, { target: { value: ' gpu ' } });
    expect(screen.getByRole('heading', { name: '性能报告' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '营收口径' })).toBeNull();
    fireEvent.change(search, { target: { value: 'EVIDENCE' } });
    expect(screen.getByRole('heading', { name: '待核验材料' })).toBeVisible();
    fireEvent.change(search, { target: { value: '不存在的关键词' } });
    expect(screen.getByText('没有匹配内容。')).toBeVisible();
  });

  it('rejects files above 20 MB locally, then accepts the exact limit and clears stale errors', async () => {
    const fetcher = vi.fn(async () => response({ projectVersion: 2 }));
    vi.stubGlobal('fetch', fetcher); const onUploaded = vi.fn();
    render(<ProjectKnowledgeUpload projectId="p1" version={1} onUploaded={onUploaded} />);
    const oversized = new File(['x'], '过大.txt', { type: 'text/plain' });
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText('知识库文件'), { target: { files: [oversized] } });
    fireEvent.click(screen.getByRole('button', { name: '上传到知识库' }));
    expect(screen.getByRole('alert')).toHaveTextContent('单文件不能超过 20 MB。');
    expect(fetcher).not.toHaveBeenCalled();
    const exact = new File(['x'], '边界.txt', { type: 'text/plain' });
    Object.defineProperty(exact, 'size', { value: 20 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('知识库文件'), { target: { files: [exact] } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '上传到知识库' }));
    await screen.findByText('资料已加入项目知识库，可向项目助手提问。');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '上传到知识库' })).toBeDisabled();
  });

  it('retains failed upload selection and retry key, then follows both returned and refreshed versions', async () => {
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new Error('网络暂不可用'))
      .mockResolvedValueOnce(response({ projectVersion: 8 }))
      .mockResolvedValueOnce(response({ projectVersion: 9 }))
      .mockResolvedValueOnce(response({ projectVersion: 13 }));
    vi.stubGlobal('fetch', fetcher); const onUploaded = vi.fn();
    const { rerender } = render(<ProjectKnowledgeUpload projectId="p1" version={7} onUploaded={onUploaded} />);
    const select = (name: string) => fireEvent.change(screen.getByLabelText('知识库文件'), { target: { files: [new File(['资料'], name, { type: 'text/plain' })] } });
    select('第一份.txt'); fireEvent.click(screen.getByRole('button', { name: '上传到知识库' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络暂不可用');
    expect(screen.getByRole('button', { name: '上传到知识库' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '上传到知识库' }));
    await screen.findByText('资料已加入项目知识库，可向项目助手提问。');
    expect(fetcher.mock.calls[0][1].headers).toEqual(fetcher.mock.calls[1][1].headers);
    rerender(<ProjectKnowledgeUpload projectId="p1" version={7} onUploaded={onUploaded} />);
    select('第二份.txt'); fireEvent.click(screen.getByRole('button', { name: '上传到知识库' }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(2));
    rerender(<ProjectKnowledgeUpload projectId="p1" version={12} onUploaded={onUploaded} />);
    select('第三份.txt'); fireEvent.click(screen.getByRole('button', { name: '上传到知识库' }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(3));
    expect(fetcher.mock.calls.map(([, init]) => (init.body as FormData).get('expectedVersion'))).toEqual(['7', '7', '8', '12']);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('disables duplicate submissions until a slow upload finishes', async () => {
    let finish: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const fetcher = vi.fn(() => pending); vi.stubGlobal('fetch', fetcher);
    render(<ProjectKnowledgeUpload projectId="p1" version={1} onUploaded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('知识库文件'), { target: { files: [new File(['资料'], '上传.txt', { type: 'text/plain' })] } });
    fireEvent.click(screen.getByRole('button', { name: '上传到知识库' }));
    expect(screen.getByRole('button', { name: '正在上传…' })).toBeDisabled();
    expect(screen.getByLabelText('知识库文件')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '正在上传…' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => finish(response({ projectVersion: 2 })));
    expect(screen.getByRole('status')).toHaveTextContent('资料已加入项目知识库');
  });
});

it('refreshes the bound assistant immediately after a workspace upload and after parsing changes', async () => {
  let reads = 0;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url.endsWith('/documents')) return response({ projectVersion: 2 });
    reads += 1;
    return response({ sources: reads === 1 ? [source] : [source, { ...source, id: 'doc-2', title: '新上传.txt', availability: reads > 2 ? 'ready' : 'pending' }], runs: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  const document = { id: 'doc-1', projectId: 'p1', originalName: '融资资料.txt', kind: 'text', mediaType: 'text/plain', byteLength: 100, externalPolicy: 'local_only', parseStatus: 'queued', analysisStatus: 'queued', createdAt: '2026-09-04' };
  const { rerender } = render(<ProjectKnowledgeWorkspace projectId="p1" projectName="项目一" version={1} documents={[document]} knowledge={[]} />);
  await screen.findByText('已连接 1 项项目资料');
  fireEvent.change(screen.getByLabelText('知识库文件'), { target: { files: [new File(['新增正文'], '新上传.txt', { type: 'text/plain' })] } });
  fireEvent.click(screen.getByRole('button', { name: '上传到知识库' }));
  await screen.findByText('已连接 2 项项目资料');
  expect(reads).toBe(2);
  rerender(<ProjectKnowledgeWorkspace projectId="p1" projectName="项目一" version={2} documents={[{ ...document, parseStatus: 'succeeded' }]} knowledge={[]} />);
  await waitFor(() => expect(reads).toBe(3));
  await screen.findByText('已连接 2 项项目资料');
});

it('keeps the selected file after a server version conflict and retries against refreshed props', async () => {
  const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: '版本冲突，请刷新项目' } }), { status: 409 }))
    .mockResolvedValueOnce(response({ projectVersion: 9 }));
  vi.stubGlobal('fetch', fetcher); const onUploaded = vi.fn();
  const { rerender } = render(<ProjectKnowledgeUpload projectId="p1" version={7} onUploaded={onUploaded} />);
  fireEvent.change(screen.getByLabelText('知识库文件'), { target: { files: [new File(['正文'], '版本核对.txt', { type: 'text/plain' })] } });
  fireEvent.click(screen.getByRole('button', { name: '上传到知识库' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('版本冲突');
  expect(onUploaded).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
  rerender(<ProjectKnowledgeUpload projectId="p1" version={8} onUploaded={onUploaded} />);
  fireEvent.click(screen.getByRole('button', { name: '上传到知识库' }));
  await screen.findByText('资料已加入项目知识库，可向项目助手提问。');
  expect((fetcher.mock.calls[1][1].body as FormData).get('expectedVersion')).toBe('8');
  expect(screen.queryByRole('alert')).toBeNull(); expect(onUploaded).toHaveBeenCalledOnce();
});

it('does not replace a just-completed answer with an older running history snapshot', async () => {
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return response(answer({ output: '最新完成的回答', updatedAt: '2026-09-04T10:02:00Z' }));
    reads += 1;
    return response({ sources: [source], runs: reads === 1 ? [] : [answer({ status: 'running', output: '', updatedAt: '2026-09-04T10:01:00Z' })] });
  }));
  render(<ProjectAssistant projectId="p1" projectName="项目一" refreshToken="1" />);
  await screen.findByText('已连接 1 项项目资料'); question();
  fireEvent.click(screen.getByRole('button', { name: '基于项目知识回答' }));
  await screen.findByText('最新完成的回答');
  fireEvent.click(screen.getByRole('button', { name: '刷新知识与记录' }));
  await waitFor(() => expect(reads).toBe(2));
  await screen.findByText('已连接 1 项项目资料');
  fireEvent.click(screen.getByRole('button', { name: '我的项目问答记录' }));
  expect(screen.getByText('项目优势是什么？ · 已完成')).toBeVisible();
  expect(screen.queryByText('项目优势是什么？ · 执行中')).toBeNull();
  expect(screen.queryByText('正在处理，请稍后刷新记录。')).toBeNull();
});
