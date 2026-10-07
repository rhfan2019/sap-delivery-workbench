import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { batchPrefix, resolveAnswers } from './policy.mjs';
import { readJson, saveJson, acquireLock } from './storage.mjs';
const active = (s) => ['running', 'queued'].includes(s);
export async function executeBatch({
  client,
  config,
  dir,
  retryFailed = false,
  log = console.log,
  signal,
}) {
  const unlock = acquireLock(dir),
    statePath = join(dir, 'state.json');
  let state;
  try {
    state = existsSync(statePath)
      ? readJson(statePath)
      : {
          version: 1,
          id: randomUUID(),
          prefix: batchPrefix(),
          createdAt: new Date().toISOString(),
          projectId: config.projectId,
          cases: config.codes.map((code) => ({
            code,
            copyRequestId: randomUUID(),
            runs: [],
            status: 'queued',
          })),
        };
    if (
      state.projectId !== config.projectId ||
      JSON.stringify(state.cases.map((c) => c.code)) !== JSON.stringify(config.codes)
    )
      throw Error('恢复时不能变更项目或开发项清单');
    const checkpoint = () => saveJson(statePath, state);
    checkpoint();
    saveJson(join(dir, 'config.json'), config);
    const base = `/api/projects/${state.projectId}/development-items`;
    const catalog = await client.request(base);
    for (const item of state.cases) {
      signal?.throwIfAborted();
      if (item.status === 'completed') {
        if (item.originalUnchanged === undefined) {
          item.originalAfter = await client.request(base + '/' + item.source.id);
          item.originalUnchanged =
            JSON.stringify(item.originalAfter) === JSON.stringify(item.source);
          checkpoint();
        }
        continue;
      }
      if (item.status === 'failed' && !retryFailed) continue;
      const caseDir = join(dir, item.code);
      mkdirSync(caseDir, { recursive: true });
      if (!item.source) {
        const matches = catalog.items.filter((x) => x.code === item.code);
        if (matches.length !== 1) throw Error(`开发项不存在或不唯一: ${item.code}`);
        item.source = matches[0];
        saveJson(join(caseDir, 'source.json'), item.source);
        checkpoint();
      }
      if (!item.copy) {
        item.copy = await client.request(`${base}/${item.source.id}/test-copy`, {
          prefix: state.prefix,
          requestId: item.copyRequestId,
        });
        checkpoint();
      }
      const work = `${base}/${item.copy.id}/work/design`,
        agent = work + '/agent';
      await client.request(work, {});
      let next =
        item.status === 'failed' && retryFailed && item.currentRunId
          ? { retryRunId: item.currentRunId }
          : null;
      item.status = 'running';
      item.startedAt ??= new Date().toISOString();
      checkpoint();
      log(`CASE ${item.code} -> ${item.copy.code}`);
      for (let turn = 0; turn < (config.maxTurns ?? 16); turn++) {
        signal?.throwIfAborted();
        if (!item.pending && (!item.currentRunId || next)) {
          const models = await client.request(work + '/models');
          const model = models.items.find((m) => m.id === models.defaultModel?.id);
          if (!model) throw Error('未设置默认模型');
          // Match the UI: selected default model, latest configuration and standard auto action.
          const payload = {
            modelId: model.id,
            rowVersion: model.rowVersion,
            requestId: randomUUID(),
            prompt: '生成FSD',
            messages: [],
            selection: {
              projectId: state.projectId,
              itemId: item.copy.id,
              itemRowVersion: item.copy.rowVersion,
              workspaceStage: 'design',
              environment: 'DEV',
            },
            action: 'auto',
            ...(item.conversationId ? { conversationId: item.conversationId } : {}),
            ...next,
          };
          item.pending = {
            payload,
            model: {
              id: model.id,
              name: model.name,
              modelId: model.modelId,
              versionId: model.versionId,
            },
          };
          checkpoint();
          next = null;
        }
        if (item.pending) {
          const p = item.pending;
          let receipt = await client.request(agent + '/runs/by-request/' + p.payload.requestId);
          if (!receipt.runId) receipt = await client.request(agent + '/runs', p.payload);
          item.currentRunId = receipt.runId;
          item.conversationId = receipt.conversationId;
          if (!item.runs.includes(receipt.runId)) item.runs.push(receipt.runId);
          saveJson(join(caseDir, receipt.runId + '.request.json'), p);
          delete item.pending;
          checkpoint();
          log(`RUN ${item.code} ${receipt.runId}`);
        }
        let result = await client.request(agent + '/runs/' + item.currentRunId);
        saveJson(join(caseDir, item.currentRunId + '.json'), result);
        if (
          result.snapshot?.input?.selection?.itemId !== item.copy.id ||
          result.conversationId !== item.conversationId
        )
          throw Error('隔离断言失败：运行不属于当前副本/会话');
        if (active(result.state)) {
          const streamController = new AbortController();
          const abort = () => streamController.abort();
          signal?.addEventListener('abort', abort, { once: true });
          const timeout = setTimeout(
            () => streamController.abort(Error('单次运行超过执行器等待上限')),
            (config.runTimeoutSeconds ?? 2400) * 1000,
          );
          try {
            await client.stream(
              agent + '/runs/' + item.currentRunId + '/events',
              (e) => {
                if (!['technical.delta', 'message.delta', 'generation.progress'].includes(e.type))
                  appendFileSync(
                    join(caseDir, item.currentRunId + '.events.jsonl'),
                    JSON.stringify({ ...e, receivedAt: new Date().toISOString() }) + '\n',
                  );
                if (e.type === 'step.updated')
                  log(`${item.code} ${e.data.stepId} ${e.data.status} ${e.data.summary ?? ''}`);
              },
              { signal: streamController.signal },
            );
          } catch (error) {
            result = await client.request(agent + '/runs/' + item.currentRunId);
            if (active(result.state)) {
              saveJson(join(caseDir, item.currentRunId + '.json'), result);
              const partialTrace = await client
                .request(agent + '/runs/' + item.currentRunId + '/trace')
                .catch(() => null);
              if (partialTrace)
                saveJson(join(caseDir, item.currentRunId + '.trace.json'), partialTrace);
              // Do not advance to another case while this model call may still be live.
              item.status = 'interrupted';
              item.interruption = error.message;
              checkpoint();
              throw error;
            }
          } finally {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
          }
          result = await client.request(agent + '/runs/' + item.currentRunId);
          for (let i = 0; active(result.state) && i < 5; i++) {
            await delay(300);
            result = await client.request(agent + '/runs/' + item.currentRunId);
          }
        }
        if (active(result.state)) throw Error('运行仍在执行，批次停止以避免重叠');
        saveJson(join(caseDir, item.currentRunId + '.json'), result);
        const trace = await client.request(agent + '/runs/' + item.currentRunId + '/trace');
        saveJson(join(caseDir, item.currentRunId + '.trace.json'), trace);
        if (result.state === 'waiting_user') {
          const answers = resolveAnswers(
            result.snapshot.decision,
            config.answers?.[item.code] ?? [],
          );
          saveJson(join(caseDir, item.currentRunId + '.answers.json'), answers);
          if (answers.missing.length) {
            item.status = 'waiting_answers';
            item.missing = answers.missing;
            checkpoint();
            log(`WAIT ${item.code} ${JSON.stringify(answers.missing)}`);
            break;
          }
          next = { resumeRunId: item.currentRunId, decisionAnswer: answers.answer };
          continue;
        }
        if (result.state !== 'completed') {
          item.status = 'failed';
          item.failure = result.snapshot.failure ?? { code: 'UNKNOWN', message: '运行未完成' };
          item.finishedAt = new Date().toISOString();
          checkpoint();
          break;
        }
        const wf = await client.request(
          agent + '/conversations/' + item.conversationId + '/workflow',
        );
        if (wf.phase === 'draft_review') {
          if (!config.approveTestDraft) {
            item.status = 'waiting_draft_approval';
            checkpoint();
            break;
          }
          item.approval ??= {
            command: 'approve_draft',
            expectedVersion: wf.version,
            revisionId: wf.activeRevisionId,
            contentHash: wf.activeContentHash,
            requestId: randomUUID(),
          };
          checkpoint();
          await client.request(
            agent + '/conversations/' + item.conversationId + '/workflow',
            item.approval,
          );
          saveJson(join(caseDir, 'test-draft-approval.json'), { ...item.approval, testOnly: true });
          delete item.approval;
          checkpoint();
          next = { prompt: '完善并生成完整说明书FSD' };
          continue;
        }
        if (wf.phase === 'refining') {
          if (
            item.approval &&
            wf.draftApproval?.revisionId === item.approval.revisionId &&
            wf.draftApproval?.contentHash === item.approval.contentHash
          ) {
            saveJson(join(caseDir, 'test-draft-approval.json'), {
              ...item.approval,
              testOnly: true,
              recovered: true,
            });
            delete item.approval;
            checkpoint();
          }
          next = { prompt: '完善并生成完整说明书FSD' };
          continue;
        }
        if (['final_review', 'completed'].includes(wf.phase) && wf.activeArtifact?.id) {
          item.artifactId = wf.activeArtifact.id;
          item.status = 'completed';
          delete item.failure;
          item.finishedAt = new Date().toISOString();
          saveJson(join(caseDir, 'artifact.json'), wf.activeArtifact);
          writeFileSync(join(caseDir, '说明书.md'), wf.activeArtifact.markdown);
          const spec = wf.activeArtifact.spec;
          if (!spec || !wf.activeArtifact.markdown?.trim()) throw Error('保存回读未取得完整说明书');
          item.finalPhase = wf.phase;
          checkpoint();
          log(`SAVED ${item.code} ${item.artifactId}`);
          break;
        }
        item.status = 'failed';
        item.failure = { code: 'NO_ARTIFACT', message: '流程结束但没有完整说明书' };
        checkpoint();
        break;
      }
      if (item.status === 'running') {
        item.status = 'turn_limit';
        checkpoint();
      }
      if (item.status !== 'waiting_answers') delete item.missing;
      item.originalAfter = await client.request(base + '/' + item.source.id);
      item.originalUnchanged = JSON.stringify(item.originalAfter) === JSON.stringify(item.source);
      checkpoint();
    }
    state.updatedAt = new Date().toISOString();
    state.status = state.cases.every((c) => c.status === 'completed') ? 'completed' : 'incomplete';
    checkpoint();
    return state;
  } finally {
    unlock();
  }
}
