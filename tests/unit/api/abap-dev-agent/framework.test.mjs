import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAMEWORK,
  bundledSource,
  extractDefinition,
  frameworkSection,
  loadFramework,
} from '../../../../apps/api/src/modules/abap-dev-agent/framework.mjs';

test('the base class keeps public and protected parts; utilities keep only public', async () => {
  const base = extractDefinition(await bundledSource('YCL_FRH_REPORT'), { keepProtected: true });
  assert.match(base, /^class YCL_FRH_REPORT definition/i);
  assert.match(base, /PROTECTED SECTION/i);
  assert.match(base, /METHODS select/i);
  assert.doesNotMatch(base, /private section/i);
  assert.doesNotMatch(base, /SET_SELSCR_TEXTS/i);
  assert.doesNotMatch(base, /IMPLEMENTATION|ENDMETHOD|<SIGNATURE>/i);
  assert.match(base, /ENDCLASS\.$/);

  const auth = extractDefinition(await bundledSource('YCL_FRH_UTIL_AUTH'));
  assert.match(auth, /check_authority/);
  assert.match(auth, /check_failed/);
  assert.doesNotMatch(auth, /build_authority_where_clause/);
  // The exception class has no ENDCLASS in its copy; the cut still ends cleanly.
  const cx = extractDefinition(await bundledSource('YCX_FRH_UTIL'));
  assert.match(cx, /RAISE_FROM_TEXT[\s\S]*ENDCLASS\.$/);
});

test('the interface is a fraction of the full sources', async () => {
  let full = 0,
    cut = 0;
  for (const c of FRAMEWORK) {
    const source = await bundledSource(c.name);
    full += source.length;
    cut += extractDefinition(source, c).length;
  }
  assert.ok(cut < full / 5, `${cut} of ${full}`);
});

test('classes come from SAP when readable and from the bundled copy otherwise', async () => {
  const sap = {
    available: true,
    target: { systemCode: 'T1', client: '100' },
    readSource: async (url) => {
      if (url.includes('ycl_frh_report'))
        return { source: 'CLASS ycl_frh_report DEFINITION.\nPUBLIC SECTION.\nENDCLASS.' };
      throw new Error('not found');
    },
  };
  const classes = await loadFramework(sap);
  assert.equal(classes[0].origin, 'sap');
  assert.equal(classes[1].origin, 'bundled');
  assert.equal(classes[1].missingInSap, true);
  assert.match(frameworkSection(classes), /先在 SAP 中部署报表框架/);

  const offline = await loadFramework({ available: false });
  assert.ok(offline.every((c) => c.origin === 'bundled' && !c.missingInSap));
  assert.doesNotMatch(frameworkSection(offline), /部署/);
});
