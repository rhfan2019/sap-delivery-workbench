import { ref, onScopeDispose, watch } from 'vue';
import { observeRun } from './runStream';
import { ApiError } from '../../../services/session';
import { currentProject } from '../../../services/projectContext';
import {
  createWorkspaceClient,
  type Snapshot,
  type FsDocument,
  type Message,
  type MessageCreate,
  type AgentArtifact,
  type Envelope,
  type Run,
  type Workspace,
  type ChangeSet,
  type Attachment,
  type FsExport,
} from '../api';
import { canonicalJson } from '../../../../../../packages/contracts/fs-workspace/canonical.mjs';

export function useFsWorkspace(projectId: string, itemId: string) {
  const client = createWorkspaceClient(projectId, itemId);
  const snapshot = ref<Snapshot | null>(null),
    document = ref<FsDocument | null>(null),
    messages = ref<Message[]>([]),
    run = ref<Run | null>(null);
  const sessionId = ref(''),
    busy = ref(false),
    error = ref(''),
    loading = ref(true);
  const change = ref<ChangeSet | null>(null);
  const artifacts = ref<AgentArtifact[]>([]);
  const intent = ref<MessageCreate['intent']>('analyze');
  const attachments = ref<Attachment[]>([]);
  const exportResult = ref<FsExport | null>(null),
    exportRevision = ref('');
  let disposed = false,
    generation = 0;
  let stopStream: (() => void) | undefined;
  watch(
    () => run.value?.id,
    (id) => {
      stopStream?.();
      if (!id || !run.value || ['completed', 'cancelled', 'failed'].includes(run.value.status))
        return;
      stopStream = observeRun(
        client.base,
        id,
        Number(run.value.last_sequence),
        (event) => {
          if (disposed || run.value?.id !== id) return;
          run.value = {
            ...run.value,
            status: event.run_status,
            last_sequence: String(event.sequence),
          };
          if (['run.completed', 'run.waiting', 'run.failed'].includes(event.event_type))
            void scheduleRefresh();
        },
        async () => {
          try {
            const result = await client.read<Run>('/runs/' + id);
            if (disposed || run.value?.id !== id) return null;
            run.value = result.data;
            if (['completed', 'cancelled', 'failed'].includes(result.data.status)) return null;
            return Number(result.data.last_sequence);
          } catch (e) {
            if (disposed) return null;
            if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
              snapshot.value = null;
              attachments.value = [];
              exportResult.value = null;
              document.value = null;
              messages.value = [];
              change.value = null;
              artifacts.value = [];
              run.value = null;
              error.value = '访问权限已变化，请重新登录或返回项目。';
              return null;
            }
            return Number(run.value?.last_sequence ?? 0);
          }
        },
      );
    },
  );
  onScopeDispose(() => {
    disposed = true;
    generation++;
    stopStream?.();
    client.dispose();
  });
  async function action(operation: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      await operation();
    } catch (e) {
      if (disposed) return;
      error.value = e instanceof Error ? e.message : '操作失败';
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
        snapshot.value = null;
        attachments.value = [];
        exportResult.value = null;
        document.value = null;
        messages.value = [];
        run.value = null;
        change.value = null;
        artifacts.value = [];
      }
    } finally {
      busy.value = false;
      if (refreshPending && !disposed) { refreshPending = false; void action(refresh); }
    }
  }
  let refreshPending = false;
  function scheduleRefresh() {
    if (busy.value) { refreshPending = true; return; }
    return action(refresh);
  }
  async function refresh() {
    const token = ++generation;
    const response = await client.read<Snapshot>();
    if (disposed || token !== generation) return;
    snapshot.value = response.data;
    currentProject.value = projectId;
    run.value = response.data.active_runs.at(-1) ?? run.value;
    const head = response.data.workspace?.draft_head;
    if (head) {
      const result = await client.read<FsDocument>('/versions/' + head.id);
      if (!disposed && token === generation) document.value = result.data;
    }
    sessionId.value ||= response.data.sessions.find((s) => !s.archived)?.id ?? '';
    if (sessionId.value) {
      const items: Message[] = [];
      let cursor: string | null = '0';
      do {
        const result: Envelope<{items: Message[]; next_cursor: string | null}> = await client.read<{items: Message[]; next_cursor: string | null}>(
          '/sessions/' + sessionId.value + '/messages?limit=100&cursor=' + cursor);
        if (disposed || token !== generation) return;
        items.push(...result.data.items); cursor = result.data.next_cursor;
      } while (cursor);
      messages.value = items;
      const result = await client.read<{items: AgentArtifact[]}>('/sessions/' + sessionId.value + '/artifacts');
      if (disposed || token !== generation) return;
      artifacts.value = result.data.items;
    }
    if (response.data.workspace) {
      const result = await client.read<{ items: Attachment[] }>('/attachments');
      if (!disposed && token === generation) attachments.value = result.data.items;
    }
  }
  async function upload(file: File) {
    let sent = false;
    await action(async () => {
      await client.upload(file);
      sent = true;
      await refresh();
    });
    return sent;
  }
  async function requestExport(format: 'pdf' | 'docx') {
    await action(async () => {
      const head = snapshot.value?.workspace?.draft_head;
      if (!head) return;
      const result = await client.command<FsExport>('/exports', {
        document_version_id: head.id,
        format,
      });
      exportResult.value = result.data;
      exportRevision.value = head.revision;
    });
  }
  async function refreshExport() {
    await action(async () => {
      if (exportResult.value)
        exportResult.value = (
          await client.read<FsExport>('/exports/' + exportResult.value.id)
        ).data;
    });
  }
  async function parse(attachment: Attachment) {
    await action(async () => {
      run.value = (
        await client.command<Run>('/attachments/' + attachment.id + '/parse', { region_ids: [] })
      ).data;
      await refresh();
    });
  }
  async function initialize() {
    await action(refresh);
    loading.value = false;
  }
  async function create() {
    await action(async () => {
      await client.command<Workspace>('', {
        template_id: 'traditional-abap-five',
        template_version: '1.0.0',
        profile: 'report',
        legacy_source_id: null,
      });
      await refresh();
    });
  }
  async function save() {
    await action(async () => {
      const w = snapshot.value?.workspace;
      if (!w?.draft_head) return;
      await client.command(
        '/versions',
        { base_document_version: w.draft_head.id, note: '人工保存讨论稿' },
        `"ws:${w.id}:${w.revision}"`,
      );
      await refresh();
    });
  }
  let pendingMessage: { content: string; intent: MessageCreate['intent']; id: string } | null = null;
  async function send(content: string) {
    let sent = false;
    await action(async () => {
      if (!sessionId.value) {
        const result = await client.command<{ id: string }>('/sessions', { title: 'FS 讨论' });
        sessionId.value = result.data.id;
      }
      if (pendingMessage?.content !== content || pendingMessage.intent !== intent.value)
        pendingMessage = { content, intent: intent.value, id: crypto.randomUUID() };
      const result = await client.command<{ message: Message; run: Run }>(
        '/sessions/' + sessionId.value + '/messages',
        {
          client_message_id: pendingMessage!.id,
          content,
          attachment_ids: [],
          selection: null,
          intent: pendingMessage!.intent,
        },
      );
      run.value = result.data.run;
      pendingMessage = null;
      sent = true;
      await refresh();
    });
    return sent;
  }
  async function cancel() {
    await action(async () => {
      if (run.value)
        run.value = (await client.command<Run>('/runs/' + run.value.id + '/cancel', {})).data;
    });
  }
  async function resume() {
    await action(async () => {
      if (!run.value) return;
      run.value = (await client.command<Run>('/runs/' + run.value.id + '/resume', {
        checkpoint_id: null, reason: '运行条件已处理，继续 Agent 阶段',
      })).data;
      await refresh();
    });
  }
  async function inspectArtifact(artifact: AgentArtifact) {
    await action(async () => {
      if (artifact.change_set_id) change.value = (await client.read<ChangeSet>('/changes/' + artifact.change_set_id)).data;
    });
  }
  async function propose(block: FsDocument['sections'][number]['blocks'][number], text: string) {
    await action(async () => {
      const w = snapshot.value?.workspace;
      if (!w?.draft_head) return;
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(block))),
        ),
      )
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
      change.value = (
        await client.command<ChangeSet>(
          '/manual-edits',
          {
            base_document_version: w.draft_head.id,
            block_id: block.id,
            before_hash: hash,
            new_block: { ...block, text },
            reason: '人工修订内容',
          },
          `"ws:${w.id}:${w.revision}"`,
        )
      ).data;
    });
  }
  async function accept() {
    await action(async () => {
      const w = snapshot.value?.workspace,
        p = change.value;
      if (!w || !p) return;
      await client.command(
        '/changes/' + p.change_set_id + '/accept',
        {
          base_document_version: p.context.base_document_version,
          accepted_group_ids: p.atomic_groups.map((g) => g.id),
        },
        `"ws:${w.id}:${w.revision}"`,
      );
      change.value = null;
      await refresh();
    });
  }
  async function reject() {
    await action(async () => {
      if (!change.value) return;
      await client.command('/changes/' + change.value.change_set_id + '/reject', {
        reason: '人工拒绝候选',
      });
      change.value = null;
      await refresh();
    });
  }
  return {
    artifacts,
    intent,
    resume,
    inspectArtifact,
    snapshot,
    attachments,
    exportResult,
    exportRevision,
    requestExport,
    refreshExport,
    upload,
    parse,
    document,
    messages,
    run,
    change,
    busy,
    error,
    loading,
    initialize,
    create,
    save,
    send,
    cancel,
    propose,
    accept,
    reject,
    refresh: () => action(refresh),
  };
}
