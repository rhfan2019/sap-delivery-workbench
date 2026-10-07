import json
from pathlib import Path
from urllib.parse import unquote
from openapi_spec_validator import OpenAPIV31SpecValidator
root=Path(__file__).resolve().parent
path=root/'api.openapi.json'
spec=json.loads(path.read_text(encoding='utf-8-sig'))
errors=list(OpenAPIV31SpecValidator(spec,base_uri=path.as_uri()).iter_errors())
if errors:
    raise RuntimeError('\n'.join(str(e) for e in errors))
refs=[]
def walk(value,origin):
    if isinstance(value,dict):
        if '$ref' in value:
            ref=value['$ref']; refs.append(ref)
            file,_,fragment=ref.partition('#')
            if file.startswith(('http:','https:')): raise AssertionError('Unexpected remote ref '+ref)
            target=(origin.parent/file).resolve() if file else origin
            data=json.loads(target.read_text(encoding='utf-8-sig'))
            if fragment:
                for part in unquote(fragment).lstrip('/').split('/'):
                    data=data[part.replace('~1','/').replace('~0','~')]
        for child in value.values(): walk(child,origin)
    elif isinstance(value,list):
        for child in value: walk(child,origin)
walk(spec,path)
ops=[op['operationId'] for p in spec['paths'].values() for m,op in p.items() if m in ['get','post','put','patch','delete']]
assert len(set(ops))==len(ops)
report={'openapi':spec['openapi'],'paths':len(spec['paths']),'operations':len(ops),'schemas':len(spec['components']['schemas']),'references_checked':len(refs),'errors':[], 'scope':'Static OpenAPI 3.1 structure, local references and unique operation IDs only; no running API validation.'}
(root/'api-validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
