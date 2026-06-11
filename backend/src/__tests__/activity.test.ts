import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ORCHESTRATOR_LABELS } from '../services/agents/pipeline-labels';

describe('activity trace builders', () => {
  const clarified = { intent: 'create', enrichedPrompt: 'a todo app', designDirection: 'minimal, clean', requiredWidgets: ['listView', 'checkbox'] };
  const structure = { appName: 'Todo', navigation: { type: 'stack' }, screens: [{ name: 'Home', appBar: { title: 'Tasks' }, screenState: { variables: [{ name: 'tasks', type: 'itemList' }, { name: 'newTask', type: 'string' }] } }] };
  const design = { theme: { primaryColor: '#3F51B5', brightness: 'light', fontFamily: 'Roboto' } };

  for (const lang of ['ko', 'en'] as const) {
    test(`${lang}: clarify produces thinking + rows`, () => {
      const a = ORCHESTRATOR_LABELS[lang].activity.clarify(clarified);
      assert.ok(a.thinking.length > 0 && a.rows.length >= 1);
      assert.ok(a.rows.some(r => r.label && r.value));
    });
    test(`${lang}: structure thinking mentions the screen`, () => {
      const a = ORCHESTRATOR_LABELS[lang].activity.structure(structure);
      assert.ok(a.thinking.includes('Home'));
      assert.ok(a.rows.some(r => (r.value ?? '').includes('tasks')));
    });
    test(`${lang}: design thinking mentions the color`, () => {
      const a = ORCHESTRATOR_LABELS[lang].activity.design(design);
      assert.ok(a.thinking.includes('#3F51B5'));
    });
  }
});
