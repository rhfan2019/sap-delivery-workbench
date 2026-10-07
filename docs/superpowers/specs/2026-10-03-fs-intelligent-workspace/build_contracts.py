import json, copy
from pathlib import Path
ROOT=Path(__file__).parent
S={'type':'string'}; N={'type':['string','null']}; I={'type':'integer','minimum':0}; B={'type':'boolean'}
def enum(*v): return {'type':'string','enum':list(v)}
def arr(x): return {'type':'array','items':copy.deepcopy(x)}
def obj(**p): return {'type':'object','properties':p,'required':list(p),'additionalProperties':False}
def ref(x): return {'$ref':'#/$defs/'+x}
def nullable(x): return {'anyOf':[x,{'type':'null'}]}
D={}
D['Context']=obj(workspace_id=S,session_id=S,run_id=S,document_id=S,base_document_version=N,context_snapshot_id=S,template_id=S,template_version=S)
D['Link']=obj(evidence_id=S,locator=S,conclusion=S)
D['Issue']=obj(id=S,question=S,impact=S,owner_role=enum('business','technical','security','product'),blocking=enum('release','review','none'),entity_ids=arr(S),status=enum('open','resolved','superseded'),resolution_ref=N)
D['Proposal']=obj(id=S,revision=I,text=S,classification=enum('source_fact','assumption','recommendation','pending'),source_refs=arr(ref('Link')),depends_on=arr(S))
D['Target']=obj(system_id=S,client=S,release=S)
D['VerificationRequest']=obj(id=S,target=ref('Target'),claim=S,object_type=enum('table','field','domain','transaction','interface','enhancement','authorization','behavior'),candidate_name=N,scope=S,required_evidence=S,blocking=enum('release','review','none'),related_ids=arr(S))
D['Row']=obj(id=S,cells=arr(S))
D['Block']=obj(id=S,kind=enum('paragraph','table','callout'),text=N,columns=arr(S),rows=arr(ref('Row')),classification=enum('source_fact','assumption','recommendation','pending'),requirement_ids=arr(S),rule_ids=arr(S),decision_ids=arr(S),evidence_refs=arr(ref('Link')))
D['Section']=obj(id=S,template_slot=S,title=S,blocks=arr(ref('Block')))
D['Test']=obj(id=S,title=S,preconditions=arr(S),steps=arr(S),expected=arr(S),requirement_ids=arr(S),rule_ids=arr(S),section_ids=arr(S),evidence_refs=arr(ref('Link')))
D['Choice']=obj(id=S,label=S,consequence=S,recommended=B)
D['Question']=obj(issue_id=S,question=S,options=arr(ref('Choice')),decision_subject_id=S,decision_subject_revision=I,decision_subject_hash=S)
D['Verification']=obj(id=S,target=ref('Target'),claim=S,object_name=N,scope=S,status=enum('unverified','verified','conflict','expired','not_applicable','not_found','unreadable'),evidence_ids=arr(S),checked_at=N,valid_until=N,limitations=arr(S),applicability=enum('pending','supported','unsupported'),applicability_reason=S)
D['Confirmation']=obj(subject_id=S,subject_revision=I,subject_hash=S,state=enum('unconfirmed','confirmed','invalidated','rejected'),actor_id=N,confirmed_at=N,record_id=N)
D['Finding']=obj(id=S,rule_id=S,severity=enum('blocker','major','minor','info'),entity_ids=arr(S),description=S,evidence_refs=arr(ref('Link')),suggested_fix=S)
D['Operation']=obj(op=enum('add','replace','remove'),entity_type=enum('requirement','rule','decision','issue','verification_request','section','block','test'),target_id=S,expected_revision=nullable(I),before_hash=N,value=nullable({'anyOf':[ref('Proposal'),ref('Issue'),ref('VerificationRequest'),ref('Section'),ref('Block'),ref('Test')]}),reason=S)
D['Impact']=obj(entity_id=S,reason=S,action=enum('revise','invalidate_confirmation','invalidate_review','reverify','inspect'))
D['EventData']=obj(message=S,progress=nullable({'type':'number','minimum':0,'maximum':1}),entity_ids=arr(S),error_code=N,retryable=B,result_version_id=N,checkpoint_id=N)
base={'schema_version':{'type':'string','const':'1.0.0'},'context':ref('Context')}
def contract(name,layer,**props):
    s=obj(**base,**props); s.update({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://fs-workspace.example/schemas/'+name+'.schema.json','title':name,'description':layer})
    needed=set()
    def walk(x):
        if isinstance(x,dict):
            if '$ref' in x:
                k=x['$ref'].split('/')[-1]
                if k not in needed: needed.add(k); walk(D[k])
            for k,v in x.items():
                if k!='$ref': walk(v)
        elif isinstance(x,list):
            for v in x:walk(v)
    walk(s);s['$defs']={k:D[k] for k in sorted(needed)}
    (ROOT/'schemas'/f'{name}.schema.json').write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n',encoding='utf8');return s
schemas={}
def add(name,layer,**kw): schemas[name]=contract(name,layer,**kw)
add('RequirementAnalysis','llm proposal only',summary=S,requirements=arr(ref('Proposal')),rules=arr(ref('Proposal')),issues=arr(ref('Issue')),verification_requests=arr(ref('VerificationRequest')),source_coverage=arr(obj(evidence_id=S,covered_locators=arr(S),unread_locators=arr(S),limitations=arr(S))))
add('Clarification','llm proposal only',questions=arr(ref('Question')),decision_proposals=arr(ref('Proposal')),deferred_issue_ids=arr(S),summary=S)
add('FsProposal','llm proposal only',title=S,sections=arr(ref('Section')),tests=arr(ref('Test')),open_issue_ids=arr(S),decision_refs=arr(S),verification_refs=arr(S),mode=enum('discussion','review_candidate'))
add('ChangeSet','llm proposal only',change_set_id=S,reason=S,operations=arr(ref('Operation')),impacts=arr(ref('Impact')),atomic_groups=arr(obj(id=S,operation_target_ids=arr(S),reason=S)),new_issue_ids=arr(S))
add('ReviewResult','llm advisory review only',review_id=S,document_hash=S,ruleset_version=S,recommendation=enum('ready_for_human_review','revise','discussion_only'),findings=arr(ref('Finding')),coverage=arr(obj(rule_id=S,entity_ids=arr(S),result=enum('pass','fail','not_applicable','not_checked'),reason=S)),limitations=arr(S))
add('VerificationProposal','llm interpretation only',request_id=S,evidence_refs=arr(ref('Link')),candidate_conclusion=S,applicability_reason=S,unresolved=arr(ref('Issue')),next_queries=arr(ref('VerificationRequest')))
add('OrchestratorPlan','llm proposal only',summary=S,next_action=enum('analyze','clarify','verify','generate','revise','review','wait'),reason=S,required_entity_ids=arr(S),issue_ids=arr(S))
add('RequirementRecord','server persisted domain',id=S,revision=I,kind=enum('requirement','rule'),content=ref('Proposal'),confirmation=ref('Confirmation'),created_at=S,updated_at=S)
add('DecisionRecord','server persisted domain',id=S,revision=I,content=ref('Proposal'),confirmation=ref('Confirmation'),supersedes_id=N)
add('EvidenceRecord','server persisted domain',id=S,source_kind=enum('message','attachment','sap_tool','official_document'),source_id=S,source_revision=S,content_hash=S,locator=S,conclusion=S,target=nullable(ref('Target')),scope=S,collected_at=S,expires_at=N,limitations=arr(S),tool_receipt_id=N,access_scope_id=S)
add('FsDocument','server persisted domain',id=S,revision=I,version_number=I,title=S,content_hash=S,lifecycle=enum('draft','in_review','approved','superseded','withdrawn'),sections=arr(ref('Section')),tests=arr(ref('Test')),requirement_refs=arr(S),rule_refs=arr(S),decision_refs=arr(S),open_issue_ids=arr(S),verifications=arr(ref('Verification')),confirmation_refs=arr(S),review_refs=arr(S),approval_refs=arr(S),evidence_manifest_ids=arr(S),created_at=S,created_by=S)
add('ApprovalRecord','server persisted domain',id=S,document_version_id=S,document_hash=S,review_ids=arr(S),evidence_manifest_hash=S,policy_version=S,actor_id=S,actor_role=S,action=enum('approve','reject','withdraw'),reason=S,created_at=S)
add('RunEvent','server event only',event_id=S,sequence=I,occurred_at=S,event_type=enum('run.queued','run.started','run.progress','run.waiting','artifact.proposed','draft.saved','review.submitted','approval.recorded','baseline.published','export.ready','run.failed','run.cancelled','run.completed'),run_status=enum('queued','running','waiting_user','waiting_evidence','failed','cancel_requested','cancelled','completed'),node_id=S,data=ref('EventData'))
# Executable illustrative fixtures. IDs denote an in-memory fixture, never real SAP proof.
ctx=dict(workspace_id='ws-demo',session_id='session-demo',run_id='run-demo',document_id='fs-demo',base_document_version='dv-7',context_snapshot_id='ctx-7',template_id='traditional-abap-five',template_version='1.0.0')
link=dict(evidence_id='ev-message-1',locator='message:msg-1#chars=0-20',conclusion='用户要求供应商未清项批量处理')
proposal=dict(id='tmp:req-1',revision=0,text='在同公司代码、供应商及币种边界内建议进行精确匹配。',classification='recommendation',source_refs=[link],depends_on=[])
issue=dict(id='tmp:issue-1',question='是否允许非零容差？',impact='影响差额处理、审批与验收',owner_role='business',blocking='release',entity_ids=['tmp:rule-1'],status='open',resolution_ref=None)
vr=dict(id='tmp:verify-1',target=dict(system_id='target-unselected',client='unknown',release='unknown'),claim='目标系统支持所需清账与事务控制',object_type='interface',candidate_name=None,scope='签名、模拟、锁定、提交语义',required_evidence='目标系统元数据与受控测试记录',blocking='release',related_ids=['tmp:req-1'])
block=dict(id='block-1',kind='paragraph',text='讨论稿：批量处理规则待确认，尚未验证 SAP 执行对象。',columns=[],rows=[],classification='pending',requirement_ids=['req-1'],rule_ids=['rule-1'],decision_ids=[],evidence_refs=[link])
section=dict(id='section-1',template_slot='overview',title='开发概述与范围',blocks=[block])
test=dict(id='test-1',title='跨币种候选隔离',preconditions=['同供应商存在 CNY 与 USD 项目'],steps=['生成匹配候选'],expected=['不跨币种匹配或合计'],requirement_ids=['req-1'],rule_ids=['rule-1'],section_ids=['section-1'],evidence_refs=[])
confirmation=dict(subject_id='req-1',subject_revision=1,subject_hash='fixture-hash-r1',state='unconfirmed',actor_id=None,confirmed_at=None,record_id=None)
fixtures={
'RequirementAnalysis':dict(summary='提取需求，保留容差与执行对象缺口',requirements=[proposal],rules=[{**proposal,'id':'tmp:rule-1'}],issues=[issue],verification_requests=[vr],source_coverage=[dict(evidence_id='ev-message-1',covered_locators=[link['locator']],unread_locators=[],limitations=['需求描述不包含完整财务口径'])]),
'Clarification':dict(questions=[dict(issue_id='tmp:issue-1',question=issue['question'],options=[dict(id='exact',label='只允许精确匹配',consequence='非零差额保留未处理',recommended=True),dict(id='tolerance',label='允许容差',consequence='还需确定金额、币种及差额处理',recommended=False)],decision_subject_id='rule-1',decision_subject_revision=1,decision_subject_hash='fixture-hash-rule-1')],decision_proposals=[],deferred_issue_ids=[],summary='优先确认影响方案的容差规则'),
'FsProposal':dict(title='供应商未清项批量处理讨论稿',sections=[section],tests=[test],open_issue_ids=['issue-1'],decision_refs=[],verification_refs=['verify-1'],mode='discussion'),
'ChangeSet':dict(change_set_id='tmp:change-1',reason='用户要求研究容差方案',operations=[dict(op='replace',entity_type='rule',target_id='rule-1',expected_revision=1,before_hash='fixture-hash-rule-1',value={**proposal,'id':'rule-1','revision':2,'text':'建议增加容差分支；金额与差额处理尚待确认。'},reason='用户新意图')],impacts=[dict(entity_id='rule-1',reason='核心规则改变',action='invalidate_confirmation'),dict(entity_id='test-1',reason='需补充容差边界用例',action='revise')],atomic_groups=[dict(id='group-1',operation_target_ids=['rule-1'],reason='规则修订必须连同失效标记提交')],new_issue_ids=[]),
'ReviewResult':dict(review_id='tmp:review-1',document_hash='fixture-hash-dv7',ruleset_version='1.0.0',recommendation='discussion_only',findings=[dict(id='tmp:finding-1',rule_id='SAP-EVIDENCE-01',severity='blocker',entity_ids=['verify-1'],description='SAP 执行对象与事务语义尚无目标系统证据',evidence_refs=[],suggested_fix='完成目标系统证据验证后重审')],coverage=[dict(rule_id='SAP-EVIDENCE-01',entity_ids=['verify-1'],result='fail',reason='证据缺失')],limitations=['该评审为 AI 建议，不构成人工审批']),
'VerificationProposal':dict(request_id='verify-1',evidence_refs=[],candidate_conclusion='未取得技术证据，不能判断可行性',applicability_reason='目标系统尚未选择',unresolved=[{**issue,'id':'tmp:technical-gap','owner_role':'technical'}],next_queries=[vr]),
'OrchestratorPlan':dict(summary='先澄清容差边界',next_action='clarify',reason='会影响核心财务控制',required_entity_ids=['rule-1'],issue_ids=['issue-1']),
'RequirementRecord':dict(id='req-1',revision=1,kind='requirement',content={**proposal,'id':'req-1','revision':1},confirmation=confirmation,created_at='2026-10-03T08:00:00Z',updated_at='2026-10-03T08:00:00Z'),
'DecisionRecord':dict(id='decision-1',revision=1,content={**proposal,'id':'decision-1','revision':1},confirmation={**confirmation,'subject_id':'decision-1'},supersedes_id=None),
'EvidenceRecord':dict(id='ev-message-1',source_kind='message',source_id='msg-1',source_revision='1',content_hash='fixture-hash-msg1',locator=link['locator'],conclusion=link['conclusion'],target=None,scope='用户表达的需求意图',collected_at='2026-10-03T08:00:00Z',expires_at=None,limitations=['不能证明 SAP 元数据或客户已批准规则'],tool_receipt_id=None,access_scope_id='project-demo'),
'FsDocument':dict(id='dv-7',revision=7,version_number=0,title='供应商未清项批量处理讨论稿',content_hash='fixture-hash-dv7',lifecycle='draft',sections=[section],tests=[test],requirement_refs=['req-1'],rule_refs=['rule-1'],decision_refs=[],open_issue_ids=['issue-1'],verifications=[dict(id='verify-1',target=vr['target'],claim=vr['claim'],object_name=None,scope=vr['scope'],status='unverified',evidence_ids=[],checked_at=None,valid_until=None,limitations=['目标系统尚未选择'],applicability='pending',applicability_reason='缺少技术证据')],confirmation_refs=[],review_refs=[],approval_refs=[],evidence_manifest_ids=['ev-message-1'],created_at='2026-10-03T08:00:00Z',created_by='user-demo'),
'ApprovalRecord':dict(id='approval-1',document_version_id='dv-7',document_hash='fixture-hash-dv7',review_ids=['review-1'],evidence_manifest_hash='fixture-evidence-hash',policy_version='1.0.0',actor_id='approver-demo',actor_role='business_approver',action='reject',reason='技术证据缺失',created_at='2026-10-03T08:00:00Z'),
'RunEvent':dict(event_id='event-17',sequence=17,occurred_at='2026-10-03T08:00:00Z',event_type='run.waiting',run_status='waiting_evidence',node_id='N06',data=dict(message='等待目标系统证据，可继续讨论稿',progress=None,entity_ids=['verify-1'],error_code=None,retryable=False,result_version_id=None,checkpoint_id='cp-16'))}
for name,data in fixtures.items():
    data={'schema_version':'1.0.0','context':ctx,**data}
    (ROOT/'examples'/f'{name}.valid.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    invalid=copy.deepcopy(data);invalid['unexpected_authority']='approved'
    (ROOT/'examples'/f'{name}.invalid.json').write_text(json.dumps(invalid,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
# Provider schemas are proposal-only. General domain/event schemas are never exposed as writable model output.
llm=['OrchestratorPlan','RequirementAnalysis','Clarification','VerificationProposal','FsProposal','ChangeSet','ReviewResult']
for name in llm:
    s=copy.deepcopy(schemas[name]);s.pop('$schema');s.pop('$id')
    def adapt(x):
        if isinstance(x,dict):
            if 'const' in x:x['enum']=[x.pop('const')]
            for v in x.values():adapt(v)
        elif isinstance(x,list):
            for v in x:adapt(v)
    adapt(s)
    (ROOT/'schemas'/f'{name}.openai.json').write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(f'Generated {len(schemas)} complete JSON Schemas, {len(llm)} provider adapters, {len(fixtures)*2} fixtures.')
