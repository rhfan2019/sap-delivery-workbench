import json
from pathlib import Path
p=Path(__file__).parent
S={'type':'string'}; U={'type':'string','format':'uuid'}; T={'type':'string','format':'date-time'}; REV={'type':'string','pattern':'^[0-9]+$'};B={'type':'boolean'}
def en(*x):return {'type':'string','enum':list(x)}
def ar(x):return {'type':'array','items':x}
def nul(x):return {'anyOf':[x,{'type':'null'}]}
def ob(**x):return {'type':'object','properties':x,'required':list(x),'additionalProperties':False}
def ref(x):return {'$ref':'#/components/schemas/'+x}
def ext(x):return {'$ref':'./schemas/'+x+'.schema.json'}
s={}
s['Meta']=ob(request_id=S,workspace_revision=nul(REV))
s['Error']=ob(code=en('INVALID_INPUT','UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','FS_WORKSPACE_ENABLED','GATE_BLOCKED','PRECONDITION_REQUIRED','PAYLOAD_TOO_LARGE','EVENT_CURSOR_EXPIRED','MODEL_CAPABILITY_REQUIRED','DEPENDENCY_MISSING','SERVICE_UNAVAILABLE'),message=S,details=ar(ob(path=S,rule_id=S,message=S,entity_ids=ar(S))),request_id=S)
s['Capabilities']=ob(can_edit=B,can_confirm=B,can_review_technical=B,can_approve_business=B,can_publish=B,can_export=B)
s['Head']=ob(id=U,revision=REV,formal_number=nul({'type':'integer','minimum':1}),content_hash=S)
s['Workspace']=ob(id=U,fs_number=S,profile=en('report','interface','enhancement','batch','tool','form'),template_id=S,template_version=S,draft_head=nul(ref('Head')),review_head=nul(ref('Head')),baseline_head=nul(ref('Head')),revision=REV)
s['Session']=ob(id=U,title=S,created_at=T,archived=B)
s['Selection']=ob(document_version_id=U,block_id=S,start={'type':'integer','minimum':0},end={'type':'integer','minimum':0},text_hash=S)
s['Message']=ob(id=U,session_id=U,sequence=REV,role=en('user','assistant','system_notice'),content=S,attachment_ids=ar(U),selection=nul(ref('Selection')),created_at=T)
s['Run']=ob(id=U,status=en('queued','running','waiting_user','waiting_evidence','failed','cancel_requested','cancelled','completed'),node_id=S,attempt={'type':'integer','minimum':0},input_snapshot_id=U,last_sequence=REV,error_code=nul(S),updated_at=T)
s['SourceRegion']=ob(id=S,locator=S,text=S,confidence=nul({'type':'number','minimum':0,'maximum':1}),rows=ar(ar(S)))
s['ParseResult']=ob(id=U,attachment_id=U,revision=REV,parser_version=S,state=en('complete','partial','failed'),regions=ar(ref('SourceRegion')),unread_regions=ar(S),warnings=ar(S),created_at=T)
s['Attachment']=ob(id=U,name=S,size_bytes={'type':'integer','minimum':1,'maximum':5242880},mime=S,sha256=S,scan_state=en('quarantined','clean','rejected','failed'),parse_result=nul(ref('ParseResult')),created_at=T)
s['ManifestEntry']=ob(id=S,revision=REV,hash=S)
s['ContextSnapshot']=ob(id=U,project_policy_version=S,target_binding=nul(S),template_version=S,schema_version=S,prompt_version=S,ruleset_version=S,model_version_id=nul(U),document_head=nul(ref('Head')),entity_manifest=ar(ref('ManifestEntry')),evidence_ids=ar(U),input_message_ids=ar(U),token_budget={'type':'integer','minimum':1},omitted_regions=ar(S),created_at=T)
s['RuleDetail']=ob(id=S,revision=REV,applicability=ar(S),input_refs=ar(S),output_refs=ar(S),algorithm_summary=S,authorization_refs=ar(S),exception_refs=ar(S),test_refs=ar(S),currency_policy=nul(ob(currencies=ar(S),scale_source=S,rounding=en('half_up','half_even','down','not_applicable'),tolerance_decimal=nul({'type':'string','pattern':'^-?[0-9]+(\\.[0-9]+)?$'}),cross_currency_allowed=B)),unit_policy=nul(S),confirmation_subject=ref('ManifestEntry'),open_issue_ids=ar(S))
s['Issue']=ob(id=S,question=S,impact=S,owner_role=en('business','technical','security','product'),blocking=en('release','review','none'),state=en('open','resolved','superseded'),entity_ids=ar(S))
s['Gate']=ob(rule_id=S,passed=B,blocking=en('release','review','none'),message=S,entity_ids=ar(S))
s['ReviewRequest']=ob(id=U,document_version_id=U,document_hash=S,state=en('open','returned','approved','closed'),policy_version=S,gates=ar(ref('Gate')),technical_approved=B,business_approved=B)
s['Export']=ob(id=U,document_version_id=U,format=en('pdf','docx'),status=en('queued','running','ready','failed'),manifest_hash=S,content_hash=nul(S),error_code=nul(S))
s['ChangeSet']=ext('ChangeSet');s['FsDocument']=ext('FsDocument');s['EvidenceRecord']=ext('EvidenceRecord');s['ReviewResult']=ext('ReviewResult');s['RunEvent']=ext('RunEvent')
s['WorkspaceCreate']=ob(template_id=S,template_version=S,profile=en('report','interface','enhancement','batch','tool','form'),legacy_source_id=nul(U))
s['SessionCreate']=ob(title=S)
s['MessageCreate']=ob(client_message_id=U,content={'type':'string','minLength':1,'maxLength':20000},attachment_ids=ar(U),selection=nul(ref('Selection')),intent=en('analyze','clarify','generate','revise','explain'))
s['AcceptChange']=ob(base_document_version=U,accepted_group_ids=ar(S))
s['ManualEdit']=ob(base_document_version=U,block_id=S,before_hash=S,new_block={'$ref':'./schemas/FsProposal.schema.json#/$defs/Block'},reason=S)
s['Confirm']=ob(subject_id=S,subject_revision=REV,subject_hash=S,context_snapshot_id=U,choice_id=S,decision_text=S)
s['SnapshotCreate']=ob(base_document_version=U,note=S)
s['Restore']=ob(source_version_id=U,base_document_version=U,reason=S)
s['ReviewCreate']=ob(document_version_id=U,document_hash=S)
s['ApprovalCreate']=ob(document_version_id=U,document_hash=S,action=en('approve','reject'),review_role=en('business_approver','technical_reviewer'),reason=S)
s['PublicationCreate']=ob(review_id=U,document_version_id=U,expected_baseline_id=nul(U))
s['ExportCreate']=ob(document_version_id=U,format=en('pdf','docx'))
s['Resume']=ob(checkpoint_id=nul(U),reason=S)
s['Empty']=ob()
s['CommandReceipt']=ob(action=S,key=U,state=en('committed','not_found'),result_ids=ar(U),request_hash=nul(S))
s['Snapshot']=ob(workspace=nul(ref('Workspace')),capabilities=ref('Capabilities'),legacy_available=B,sessions=ar(ref('Session')),active_runs=ar(ref('Run')),attachments=ar(ref('Attachment')),issues=ar(ref('Issue')))
def envelope(x):return ob(data=x,meta=ref('Meta'))
def listing(x):return ob(items=ar(x),next_cursor=nul(S))
paths={};base='/api/projects/{projectId}/development-items/{id}/fs-workspace'
def route(suffix,method,operation,summary,response,request=None,head=False,status='200',paged=False):
    path=base+suffix
    params=[{'name':v,'in':'path','required':True,'schema':U} for v in __import__('re').findall(r'{(\w+)}',path)]
    if method=='post':params.append({'name':'Idempotency-Key','in':'header','required':True,'schema':U})
    if head:params.append({'name':'If-Match','in':'header','required':True,'schema':{'type':'string','pattern':'^"ws:[0-9a-f-]+:[0-9]+"$'}})
    if paged:params += [{'name':'cursor','in':'query','schema':S},{'name':'limit','in':'query','schema':{'type':'integer','minimum':1,'maximum':100,'default':30}}]
    r={status:{'description':'成功；所有示例状态不代表已部署','content':{'application/json':{'schema':envelope(response)}}},'default':{'description':'分类错误；401/403/404/409/413/422/428/503','content':{'application/json':{'schema':ref('Error')}}}}
    op={'operationId':operation,'summary':summary,'security':[{'sessionCookie':[]}],'parameters':params,'responses':r}
    if request is not None:op['requestBody']={'required':True,'content':{'application/json':{'schema':request}}}
    paths.setdefault(path,{})[method]=op
route('','get','getFsWorkspace','读取快照，不创建工作区',ref('Snapshot'))
route('','post','createFsWorkspace','幂等创建并导入指定历史FS',ref('Workspace'),ref('WorkspaceCreate'),status='201')
route('/sessions','get','listFsSessions','会话游标列表',listing(ref('Session')),paged=True)
route('/sessions','post','createFsSession','新建会话',ref('Session'),ref('SessionCreate'),status='201')
route('/sessions/{sessionId}/messages','get','listFsMessages','消息分页',listing(ref('Message')),paged=True)
route('/sessions/{sessionId}/messages','post','sendFsMessage','原子写消息并排队运行',ob(message=ref('Message'),run=ref('Run')),ref('MessageCreate'),status='202')
route('/runs/{runId}','get','getFsRun','查询任务与恢复状态',ref('Run'))
route('/runs/{runId}/cancel','post','cancelFsRun','设置取消栅栏，保留已提交成果',ref('Run'),ref('Empty'))
route('/runs/{runId}/resume','post','resumeFsRun','重新鉴权后从检查点恢复',ref('Run'),ref('Resume'))
route('/runs/{runId}/events','get','streamFsEvents','至少一次送达的SSE事件；过期游标409',ref('RunEvent'))
event=paths[base+'/runs/{runId}/events']['get'];event['parameters'] += [{'name':'after','in':'query','schema':REV},{'name':'Last-Event-ID','in':'header','schema':REV}];event['responses']['200']['content']={'text/event-stream':{'schema':{'type':'string','description':'id: sequence\nevent: event_type\ndata: RunEvent JSON\n\n; heartbeat comments every 15s'}}}
route('/context/{snapshotId}','get','getFsContext','授权后的上下文清单，无凭证',ref('ContextSnapshot'))
route('/attachments','get','listFsAttachments','附件与解析状态',listing(ref('Attachment')),paged=True)
route('/attachments','post','uploadFsAttachment','隔离流式上传，5MiB上限',ref('Attachment'),status='202')
paths[base+'/attachments']['post']['requestBody']={'required':True,'content':{'multipart/form-data':{'schema':ob(client_upload_id=U,file={'type':'string','format':'binary'})}}}
route('/attachments/{attachmentId}/parse','post','retryFsParse','重试指定解析区域',ref('Run'),ob(region_ids=ar(S)),status='202')
route('/attachments/{attachmentId}/source','get','getFsAttachmentSource','鉴权读取来源，禁止任意文件路径',S)
paths[base+'/attachments/{attachmentId}/source']['get']['responses']['200']['content']={'application/octet-stream':{'schema':{'type':'string','format':'binary'}}}
route('/evidence/{evidenceId}','get','getFsEvidence','来源定位、范围和限制',ref('EvidenceRecord'))
route('/verifications','post','requestFsVerification','创建技术验证任务，不接受verified输入',ref('Run'),ob(verification_id=S,scope=S),status='202')
route('/changes/{changeId}','get','getFsChange','读取候选差异',ref('ChangeSet'))
route('/changes/{changeId}/accept','post','acceptFsChange','接受完整依赖组并原子创建新草稿',ref('Workspace'),ref('AcceptChange'),head=True)
route('/changes/{changeId}/reject','post','rejectFsChange','拒绝候选，不改草稿',ob(change_id=U,status=en('rejected')),ob(reason=S))
route('/manual-edits','post','proposeFsManualEdit','人工块编辑也形成ChangeSet与影响闭包',ref('ChangeSet'),ref('ManualEdit'),head=True,status='201')
route('/confirmations','post','confirmFsDecision','确认精确对象版本，不进行技术验证',ob(confirmation_id=U,workspace=ref('Workspace')),ref('Confirm'),head=True,status='201')
route('/versions','get','listFsVersions','版本历史列表',listing(ref('Head')),paged=True)
route('/versions','post','snapshotFsVersion','保存只读编号版本，不授予开发资格',ref('Head'),ref('SnapshotCreate'),head=True,status='201')
route('/versions/{versionId}','get','getFsVersion','读取固定版本AST',ref('FsDocument'))
route('/restore','post','restoreFsVersion','历史版恢复为新草稿，不继承审批',ref('Workspace'),ref('Restore'),head=True)
route('/reviews','post','submitFsReview','冻结版本送审，release缺口可供早期审阅',ref('ReviewRequest'),ref('ReviewCreate'),head=True,status='201')
route('/reviews/{reviewId}','get','getFsReview','读取检查、人工审批与固定文档',ob(request=ref('ReviewRequest'),results=ar(ref('ReviewResult'))))
route('/reviews/{reviewId}/approvals','post','recordFsApproval','按认证角色记录决定，批准必须门禁通过',ref('ReviewRequest'),ref('ApprovalCreate'),head=True,status='201')
route('/publications','post','publishFsBaseline','显式发布并原子替换开发依据',ref('Workspace'),ref('PublicationCreate'),head=True,status='201')
route('/exports','post','createFsExport','按固定版本manifest导出',ref('Export'),ref('ExportCreate'),status='202')
route('/exports/{exportId}','get','getFsExport','查询导出状态',ref('Export'))
route('/exports/{exportId}/download','get','downloadFsExport','重新鉴权后下载已完成文件',S)
paths[base+'/exports/{exportId}/download']['get']['responses']['200']['content']={'application/octet-stream':{'schema':{'type':'string','format':'binary'}}}
route('/commands/{key}','get','getFsCommandReceipt','按当前用户与action查询幂等结果',ref('CommandReceipt'))
paths[base+'/commands/{key}']['get']['parameters'].append({'name':'action','in':'query','required':True,'schema':S})
# Role administration remains project-scoped; explicit route records are not inferred from the UI role selector.
rolepath='/api/projects/{projectId}/fs-roles'
paths[rolepath]={'get':{'operationId':'listFsProjectRoles','summary':'项目内管理员读取FS角色','security':[{'sessionCookie':[]}],'parameters':[{'name':'projectId','in':'path','required':True,'schema':U}],'responses':{'200':{'description':'当前角色绑定','content':{'application/json':{'schema':envelope(ar(ob(user_id=U,roles=ar(en('business_approver','technical_reviewer','publisher')))))}}}}},'post':{'operationId':'setFsProjectRoles','summary':'管理员设置项目成员角色；审计并发版本','security':[{'sessionCookie':[]}],'parameters':[{'name':'projectId','in':'path','required':True,'schema':U},{'name':'Idempotency-Key','in':'header','required':True,'schema':U}],'requestBody':{'required':True,'content':{'application/json':{'schema':ob(user_id=U,roles=ar(en('business_approver','technical_reviewer','publisher')),expected_revision=REV)}}},'responses':{'200':{'description':'角色绑定已保存','content':{'application/json':{'schema':envelope(ob(user_id=U,roles=ar(S),revision=REV))}}},'default':{'description':'未授权或版本冲突','content':{'application/json':{'schema':ref('Error')}}}}}}
route('/changes/{changeId}/rebase','post','rebaseFsChange','保留旧候选并基于新head生成候选',ref('Run'),ob(new_base_document_version=U),head=True,status='202')
route('/versions/{versionId}/compare','get','compareFsVersions','稳定ID结构化对比，只读',ob(left_id=U,right_id=U,changes=ar(ob(entity_id=S,kind=en('added','removed','changed','unchanged'),before=nul(S),after=nul(S))),invalidated_ids=ar(S)))
paths[base+'/versions/{versionId}/compare']['get']['parameters'].append({'name':'other','in':'query','required':True,'schema':U})
route('/exports','get','listFsExports','导出历史列表',listing(ref('Export')),paged=True)
route('/publications/withdraw','post','withdrawFsBaseline','授权撤销当前依据，保留审计与历史',ref('Workspace'),ob(document_version_id=U,reason=S),head=True)
route('/verifications/{verificationId}/assessments','post','assessFsVerification','技术角色提交适用性评估，服务端核验真实证据后派生状态',ob(verification_id=S,assessment_id=U),ob(target_binding=S,evidence_ids=ar(U),scope=S,conclusion=en('supported','unsupported','inconclusive'),reason=S),head=True,status='201')
api={'openapi':'3.1.0','info':{'title':'FS Intelligent Workspace API','version':'1.1.0','description':'Design contract, not deployed. Cookie name is environment-dependent. All mutable operations enforce project scope and origin.'},'servers':[{'url':'/'}],'security':[{'sessionCookie':[]}],'paths':paths,'components':{'securitySchemes':{'sessionCookie':{'type':'apiKey','in':'cookie','name':'__Host-sapwb_session','description':'Production cookie. Local development uses sapwb_local_session, both HttpOnly/SameSite=Lax; no token query string.'}},'schemas':s}}
(p/'api.openapi.json').write_text(json.dumps(api,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('OpenAPI:',len(paths),'paths,',sum(len(v) for v in paths.values()),'operations,',len(s),'component schemas')
