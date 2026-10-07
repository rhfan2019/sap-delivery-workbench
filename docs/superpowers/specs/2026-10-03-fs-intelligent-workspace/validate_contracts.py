import json,copy
from pathlib import Path
from jsonschema import Draft202012Validator
P=Path(__file__).parent
checks=[]
def record(name,condition):
    if not condition: raise AssertionError(name)
    checks.append(name)
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
validators={}; samples={}
for path in sorted((P/'schemas').glob('*.schema.json')):
    name=path.name.split('.')[0];s=read(path);Draft202012Validator.check_schema(s)
    v=Draft202012Validator(s); validators[name]=v
    valid=read(P/'examples'/f'{name}.valid.json');samples[name]=valid
    record(name+' valid',not list(v.iter_errors(valid)))
    invalid=read(P/'examples'/f'{name}.invalid.json')
    record(name+' rejects extra authority',any(e.validator=='additionalProperties' for e in v.iter_errors(invalid)))
    missing=copy.deepcopy(valid);missing.pop('context')
    record(name+' rejects missing context',any(e.validator=='required' for e in v.iter_errors(missing)))
    record(name+' rejects root array',bool(list(v.iter_errors([]))))
for path in sorted((P/'schemas').glob('*.openai.json')):
    s=read(path);Draft202012Validator.check_schema(s)
    record(path.name+' root object',s.get('type')=='object' and 'anyOf' not in s)
    def walk(x):
        if isinstance(x,dict):
            if x.get('type')=='object':
                assert x.get('additionalProperties') is False
                assert set(x['properties'])==set(x['required'])
            for k,v in x.items():
                assert k not in {'allOf','not','if','then','else','dependentRequired','dependentSchemas'}
                walk(v)
        elif isinstance(x,list):
            for v in x:walk(v)
    walk(s);record(path.name+' strict structure',True)
    name=path.name.split('.')[0];record(path.name+' fixture',not list(Draft202012Validator(s).iter_errors(samples[name])))
for name,key,value in [('FsProposal','lifecycle','approved'),('VerificationProposal','status','verified'),('Clarification','approval_actor','admin')]:
    x=copy.deepcopy(samples[name]);x[key]=value
    record(name+' blocks '+key,bool(list(validators[name].iter_errors(x))))
x=copy.deepcopy(samples['RunEvent']);x['run_status']='approved'
record('RunEvent business status not run status',bool(list(validators['RunEvent'].iter_errors(x))))
for payload in ['{"context":','{"a":1,"a":2}']:
    def no_duplicates(pairs):
        d={}
        for k,v in pairs:
            if k in d:raise ValueError('duplicate key')
            d[k]=v
        return d
    try:json.loads(payload,object_pairs_hook=no_duplicates);caught=False
    except (ValueError,json.JSONDecodeError):caught=True
    record('JSON parser rejects '+payload,caught)
# Minimal executable specification of selected L4/L5 checks, NOT product enforcement.
def semantic_errors(name,x):
    errors=[]
    if x['context']['base_document_version']!='dv-7':errors.append('VERSION_CONFLICT')
    def walk(y):
        if isinstance(y,dict):
            if 'evidence_id' in y and y['evidence_id']!='ev-message-1':errors.append('REF_NOT_FOUND')
            if y.get('kind')=='table' and any(len(r['cells'])!=len(y['columns']) for r in y['rows']):errors.append('TABLE_SHAPE_MISMATCH')
            for v in y.values():walk(v)
        elif isinstance(y,list):
            for v in y:walk(v)
    walk(x)
    if name=='ChangeSet':
        for o in x['operations']:
            if o['op']=='remove' and o['value'] is not None:errors.append('INVALID_OPERATION_VALUE')
            if o['value'] is not None and o['target_id']!=o['value']['id']:errors.append('TARGET_VALUE_MISMATCH')
    if name=='FsDocument' and x['lifecycle']=='approved' and not x['approval_refs']:errors.append('APPROVAL_REQUIRED')
    return errors
mutations=[]
x=copy.deepcopy(samples['RequirementAnalysis']);x['requirements'][0]['source_refs'][0]['evidence_id']='ev-does-not-exist';mutations.append(('RequirementAnalysis',x,'REF_NOT_FOUND'))
x=copy.deepcopy(samples['ChangeSet']);x['context']['base_document_version']='dv-6';mutations.append(('ChangeSet',x,'VERSION_CONFLICT'))
x=copy.deepcopy(samples['ChangeSet']);x['operations'][0]['value']['id']='rule-2';mutations.append(('ChangeSet',x,'TARGET_VALUE_MISMATCH'))
x=copy.deepcopy(samples['ChangeSet']);x['operations'][0]['op']='remove';mutations.append(('ChangeSet',x,'INVALID_OPERATION_VALUE'))
x=copy.deepcopy(samples['FsDocument']);x['lifecycle']='approved';mutations.append(('FsDocument',x,'APPROVAL_REQUIRED'))
x=copy.deepcopy(samples['FsProposal']);b=x['sections'][0]['blocks'][0];b.update(kind='table',text=None,columns=['a','b'],rows=[{'id':'row1','cells':['a','b','c']}]);mutations.append(('FsProposal',x,'TABLE_SHAPE_MISMATCH'))
for name,x,error in mutations:
    record(error+' passes schema',not list(validators[name].iter_errors(x)))
    record(error+' caught by sample domain rule',error in semantic_errors(name,x))
    (P/'examples'/f'{error}.semantic-invalid.json').write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
report={'passed':len(checks),'failed':0,'checks':checks,'scope':'Design-package schema and fixture checks only; not product integration, SAP verification or live model API validation.'}
(P/'validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'passed':len(checks),'failed':0,'scope':report['scope']}))
